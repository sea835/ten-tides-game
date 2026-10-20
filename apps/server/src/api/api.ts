import type { IncomingMessage, ServerResponse } from "node:http";
import { COIN_RULES, GACHA, RARITY, SHARDS, SKINS, SKIN_RARITIES, SKIN_WEAPON_IDS, effectiveOdds, validateLoadout } from "@tentides/content";
import type { z } from "zod";
import {
  AccountError,
  craftSkin,
  equipCard,
  equipSkin,
  equippedSkins,
  login,
  logout,
  profile,
  register,
  rollGacha,
  saveLoadout,
  userFromSession,
  type PublicUser,
} from "../db/accounts.ts";
import { challengeStatus } from "../db/challenges.ts";
import { accountsEnabled } from "../db/pool.ts";
import { listPublicRooms, pickQuickRoom } from "../rooms.ts";
import { healthReport } from "../health.ts";
import { clientIp as ipOf } from "./clientIp.ts";
import { allowOrigin } from "./cors.ts";
import { RateLimiter } from "./rateLimit.ts";
import { CardBody, CraftBody, Credentials, EquipBody, LoadoutBody, LoginBody, QuickModeQuery, RollBody } from "./schemas.ts";

// API HTTP cho tài khoản và gacha, chạy chung cổng với Colyseus (gắn vào app express của transport).
// Mọi câu trả lời là JSON. CORS: Colyseus đã đặt header cho mọi request (index.ts thay luật chọn origin theo
// CORS_ORIGINS); ở đây đặt lại theo cùng luật cho chắc khi chạy tách riêng (test).

const MAX_BODY = 16 * 1024;

/** Đăng nhập, đăng ký: tối đa 10 lần mỗi phút mỗi IP. */
const authLimiter = new RateLimiter(10, 60_000);
/** Quay gacha: tối đa 30 lần mỗi phút mỗi IP (chặn bấm liên hồi, script). */
const rollLimiter = new RateLimiter(30, 60_000);
/** Danh sách phòng, Chơi nhanh: sảnh làm mới vài giây một lần, nhiều người chung một IP (quán net) nên rộng tay. */
const roomsLimiter = new RateLimiter(120, 60_000);

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
  res.setHeader("Access-Control-Allow-Origin", allowOrigin(req.headers.origin));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

/** IP người gọi: sau proxy của Render thì đọc X-Forwarded-For (clientIp.ts), không thì địa chỉ socket. */
function clientIp(req: Req): string {
  return ipOf(req.headers, req.socket.remoteAddress);
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

/** Tham số ?mode=... (Chơi nhanh, lọc danh sách phòng). Không có thì undefined, sai thì lỗi 400. */
function modeParam(req: Req, required: boolean) {
  const raw = new URL(req.url ?? "/", "http://x").searchParams.get("mode");
  if (raw === null && !required) return undefined;
  const parsed = QuickModeQuery.safeParse(raw);
  if (!parsed.success) throw new AccountError("invalid", 400, "Chế độ không hợp lệ.");
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

/**
 * Danh mục gacha (không cần đăng nhập): độ hiếm, tỷ lệ gốc và tỷ lệ thực tế khi tính cả bảo hiểm, giá, bảo hiểm,
 * mảnh (trùng ra bao nhiêu, đổi tốn bao nhiêu), toàn bộ skin.
 */
function catalog() {
  const odds = effectiveOdds();
  return {
    rarities: SKIN_RARITIES.map((id) => ({ id, ...RARITY[id], effective: odds[id] })),
    costs: { 1: GACHA.cost1, 10: GACHA.cost10 },
    pity: { epic: GACHA.epicPity, legendary: GACHA.legendaryPity },
    shards: SHARDS,
    weapons: SKIN_WEAPON_IDS,
    skins: SKINS,
  };
}

type Handler = (req: Req, res: ServerResponse) => Promise<void>;

const routes: Record<string, Handler> = {
  // Số liệu vận hành: số phòng, số người, nhịp p95 từng phòng, bộ nhớ (không có mã phòng, tên người chơi).
  "GET /api/health": async (_req, res) => send(res, 200, healthReport()),

  "GET /api/status": async (_req, res) => send(res, 200, { accounts: accountsEnabled() }),

  "GET /api/gacha/catalog": async (_req, res) => send(res, 200, catalog()),

  /** Phòng công khai đang mở (lọc theo ?mode= nếu có). */
  "GET /api/rooms": async (req, res) => {
    if (!roomsLimiter.take(clientIp(req))) return fail(res, 429, "rate_limited", "Làm mới chậm lại một chút.");
    const mode = modeParam(req, false);
    const rooms = await listPublicRooms();
    send(res, 200, { rooms: mode ? rooms.filter((r) => r.mode === mode) : rooms });
  },

  /** Chơi nhanh: mã phòng công khai nên vào (cùng chế độ, còn chỗ), hay null để client tạo phòng mới. */
  "GET /api/quickplay": async (req, res) => {
    if (!roomsLimiter.take(clientIp(req))) return fail(res, 429, "rate_limited", "Thử lại sau một chút.");
    const mode = modeParam(req, true)!;
    send(res, 200, { code: pickQuickRoom(await listPublicRooms(), mode) });
  },

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

  "POST /api/gacha/craft": async (req, res) => {
    const user = await requireUser(req);
    if (!rollLimiter.take(`${clientIp(req)}:${user.id}`)) return fail(res, 429, "rate_limited", "Chậm lại một chút.");
    const { skinId } = await parseBody(req, CraftBody);
    send(res, 200, await craftSkin(user.id, skinId));
  },

  /** Thử thách ngày, tuần (kèm tiến độ) và xu trận đã nhận hôm nay / giới hạn ngày. */
  "GET /api/challenges": async (req, res) => {
    const user = await requireUser(req);
    send(res, 200, { ...(await challengeStatus(user.id)), rules: { dailyCap: COIN_RULES.dailyCap, soloFactor: COIN_RULES.soloFactor } });
  },

  "POST /api/skins/equip": async (req, res) => {
    const user = await requireUser(req);
    const { weaponId, skinId } = await parseBody(req, EquipBody);
    send(res, 200, { equipped: await equipSkin(user.id, weaponId, skinId) });
  },

  "POST /api/profile/card": async (req, res) => {
    const user = await requireUser(req);
    const { cardId, emblemId } = await parseBody(req, CardBody);
    send(res, 200, { progress: await equipCard(user.id, cardId, emblemId) });
  },

  "POST /api/gunsmith/save": async (req, res) => {
    const user = await requireUser(req);
    const body = await parseBody(req, LoadoutBody);
    const checked = validateLoadout(body.weaponId, body.loadout);
    if (!checked.ok) throw new AccountError("invalid", 400, checked.reason);
    // Skin trước (có thể bị từ chối vì chưa có skin), rồi mới ghi bộ phụ kiện.
    const equipped = body.skinId === undefined ? undefined : await equipSkin(user.id, body.weaponId, body.skinId);
    const loadouts = await saveLoadout(user.id, body.weaponId, checked.loadout);
    send(res, 200, { loadouts, equipped: equipped ?? (await equippedSkins(user.id)) });
  },
};

/** Những đường không cần database. */
const WITHOUT_DB = new Set(["GET /api/status", "GET /api/gacha/catalog", "GET /api/rooms", "GET /api/quickplay", "GET /api/health"]);

/**
 * Xử lý một request HTTP. Trả về true nếu đã xử lý (đường /api/...), false để chuyển cho handler khác.
 * Không bao giờ ném lỗi ra ngoài: lỗi database chỉ thành câu trả lời 500.
 */
export async function handleApi(req: Req, res: ServerResponse): Promise<boolean> {
  let path = (req.url ?? "/").split("?")[0]!;
  // /health ngắn gọn cho bộ kiểm tra sống của hạ tầng (cùng nội dung /api/health).
  if (path === "/health") path = "/api/health";
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
