import type { IncomingMessage, ServerResponse } from "node:http";
import { GACHA, RARITY, SKINS, SKIN_RARITIES, SKIN_WEAPON_IDS } from "@tentides/content";
import type { z } from "zod";
import { AccountError, equipSkin, login, logout, profile, register, rollGacha, userFromSession, type PublicUser } from "../db/accounts.ts";
import { accountsEnabled } from "../db/pool.ts";
import { RateLimiter } from "./rateLimit.ts";
import { Credentials, EquipBody, LoginBody, RollBody } from "./schemas.ts";

// API HTTP cho tài khoản và gacha, chạy chung cổng với Colyseus (gắn vào app express của transport).
// Mọi câu trả lời là JSON. CORS: Colyseus đã đặt header cho mọi request (cho phép mọi origin, có Authorization);
// ở đây đặt thêm cho chắc khi chạy tách riêng (test).

const MAX_BODY = 16 * 1024;

/** Đăng nhập, đăng ký: tối đa 10 lần mỗi phút mỗi IP. */
const authLimiter = new RateLimiter(10, 60_000);
/** Quay gacha: tối đa 30 lần mỗi phút mỗi IP (chặn bấm liên hồi, script). */
const rollLimiter = new RateLimiter(30, 60_000);

type Req = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, error: string, message: string) {
  send(res, status, { error, message });
}

function cors(req: Req, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function clientIp(req: Req): string {
  return req.socket.remoteAddress ?? "?";
}

/** Đọc body JSON (Colyseus có khi đã đọc sẵn vào req.body). */
async function readJson(req: Req): Promise<unknown> {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new AccountError("too_large", 413, "Dữ liệu gửi lên quá lớn.");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AccountError("bad_json", 400, "Dữ liệu không phải JSON.");
  }
}

async function parseBody<S extends z.ZodType>(req: Req, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new AccountError("invalid", 400, parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");
  return parsed.data;
}

function bearer(req: Req): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function requireUser(req: Req): Promise<PublicUser> {
  const user = await userFromSession(bearer(req));
  if (!user) throw new AccountError("unauthorized", 401, "Chưa đăng nhập hoặc phiên đã hết hạn.");
  return user;
}

/** Danh mục gacha (không cần đăng nhập): độ hiếm, tỷ lệ, giá, bảo hiểm, toàn bộ skin. */
function catalog() {
  return {
    rarities: SKIN_RARITIES.map((id) => ({ id, ...RARITY[id] })),
    costs: { 1: GACHA.cost1, 10: GACHA.cost10 },
    pity: { epic: GACHA.epicPity, legendary: GACHA.legendaryPity },
    weapons: SKIN_WEAPON_IDS,
    skins: SKINS,
  };
}

type Handler = (req: Req, res: ServerResponse) => Promise<void>;

const routes: Record<string, Handler> = {
  "GET /api/status": async (_req, res) => send(res, 200, { accounts: accountsEnabled() }),

  "GET /api/gacha/catalog": async (_req, res) => send(res, 200, catalog()),

  "POST /api/register": async (req, res) => {
    if (!authLimiter.take(clientIp(req))) return fail(res, 429, "rate_limited", "Thử quá nhiều lần, đợi một phút rồi thử lại.");
    const { username, password } = await parseBody(req, Credentials);
    send(res, 201, await register(username, password));
  },

  "POST /api/login": async (req, res) => {
    if (!authLimiter.take(clientIp(req))) return fail(res, 429, "rate_limited", "Thử quá nhiều lần, đợi một phút rồi thử lại.");
    const { username, password } = await parseBody(req, LoginBody);
    send(res, 200, await login(username, password));
  },

  "POST /api/logout": async (req, res) => {
    const token = bearer(req);
    if (token) await logout(token);
    send(res, 200, { ok: true });
  },

  "GET /api/me": async (req, res) => {
    const user = await requireUser(req);
    send(res, 200, await profile(user.id));
  },

  "POST /api/gacha/roll": async (req, res) => {
    const user = await requireUser(req);
    if (!rollLimiter.take(`${clientIp(req)}:${user.id}`)) return fail(res, 429, "rate_limited", "Quay chậm lại một chút.");
    const { count } = await parseBody(req, RollBody);
    send(res, 200, await rollGacha(user.id, count));
  },

  "POST /api/skins/equip": async (req, res) => {
    const user = await requireUser(req);
    const { weaponId, skinId } = await parseBody(req, EquipBody);
    send(res, 200, { equipped: await equipSkin(user.id, weaponId, skinId) });
  },
};

/** Những đường không cần database. */
const WITHOUT_DB = new Set(["GET /api/status", "GET /api/gacha/catalog"]);

/**
 * Xử lý một request HTTP. Trả về true nếu đã xử lý (đường /api/...), false để chuyển cho handler khác.
 * Không bao giờ ném lỗi ra ngoài: lỗi database chỉ thành câu trả lời 500.
 */
export async function handleApi(req: Req, res: ServerResponse): Promise<boolean> {
  const path = (req.url ?? "/").split("?")[0]!;
  if (!path.startsWith("/api/")) return false;
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  const key = `${req.method} ${path}`;
  const route = routes[key];
  if (!route) {
    fail(res, 404, "not_found", "Không có đường này.");
    return true;
  }
  if (!WITHOUT_DB.has(key) && !accountsEnabled()) {
    fail(res, 503, "accounts_disabled", "Server chưa bật tài khoản (chưa có database).");
    return true;
  }
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof AccountError) fail(res, err.status, err.code, err.message);
    else {
      console.warn(`API ${key} lỗi:`, err instanceof Error ? err.message : err);
      fail(res, 500, "server_error", "Server gặp lỗi, thử lại sau.");
    }
  }
  return true;
}

/** Middleware kiểu express/connect. */
export function apiMiddleware(req: Req, res: ServerResponse, next: () => void) {
  void handleApi(req, res).then((handled) => {
    if (!handled) next();
  });
}
