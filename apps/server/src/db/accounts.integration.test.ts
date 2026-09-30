import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../api/api.ts";
import { recordMatch, userFromSession } from "./accounts.ts";
import { closeDb, db, initDb } from "./pool.ts";

// Chạy thật với PostgreSQL, chỉ khi có DATABASE_URL (vd. sau scripts/db-dev.sh). Không có thì bỏ qua.
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("tài khoản với PostgreSQL thật", () => {
  let server: Server;
  let base = "";
  const name = `t${Date.now().toString(36).slice(-8)}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    expect(await initDb(url)).toBe(true);
    server = createServer((req, res) => {
      void handleApi(req, res).then((ok) => {
        if (!ok) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await db().query("DELETE FROM users WHERE lower(username) = lower($1)", [name]).catch(() => {});
    await new Promise((r) => server?.close(r));
    await closeDb();
  });

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  it("đăng ký, đăng nhập, hồ sơ, quay, lắp skin, đăng xuất", async () => {
    const reg = await call("POST", "/api/register", { username: name, password: "matkhau123" });
    expect(reg.status).toBe(201);
    expect(reg.json.user).toMatchObject({ username: name, coins: 1000 });

    expect((await call("POST", "/api/register", { username: name.toUpperCase(), password: "matkhau123" })).status).toBe(409);
    expect((await call("POST", "/api/login", { username: name, password: "sai-roi" })).status).toBe(401);

    const log = await call("POST", "/api/login", { username: name.toUpperCase(), password: "matkhau123" });
    expect(log.status).toBe(200);
    const token = log.json.token as string;
    expect((await userFromSession(token))?.username).toBe(name);

    const roll = await call("POST", "/api/gacha/roll", { count: 10 }, token);
    expect(roll.status).toBe(200);
    expect(roll.json.results).toHaveLength(10);
    expect(roll.json.coins).toBe(100);
    // Bảo hiểm: 10 lượt đầu chắc chắn có sử thi trở lên.
    expect(roll.json.results.some((r: any) => r.rarity === "epic" || r.rarity === "legendary")).toBe(true);
    expect((await call("POST", "/api/gacha/roll", { count: 10 }, token)).status).toBe(402);

    const me = await call("GET", "/api/me", undefined, token);
    expect(me.json.user.coins).toBe(100);
    const total = me.json.skins.reduce((n: number, s: any) => n + s.count, 0);
    expect(total).toBe(10);

    // Lắp skin đầu tiên có lên một khẩu hợp.
    const { SKIN, SKIN_WEAPON_IDS } = await import("@tentides/content");
    const owned = me.json.skins[0].skinId as string;
    const weapon = SKIN.get(owned)?.weapon ?? SKIN_WEAPON_IDS[0]!;
    const eq = await call("POST", "/api/skins/equip", { weaponId: weapon, skinId: owned }, token);
    expect(eq.json.equipped[weapon]).toBe(owned);
    expect((await call("POST", "/api/skins/equip", { weaponId: weapon, skinId: "not-a-skin" }, token)).status).toBe(400);
    const off = await call("POST", "/api/skins/equip", { weaponId: weapon, skinId: "" }, token);
    expect(off.json.equipped[weapon]).toBeUndefined();

    await recordMatch("battle", [{ userId: me.json.user.id, kills: 2, placement: 1, coins: 250 }]);
    expect((await call("GET", "/api/me", undefined, token)).json.user.coins).toBe(350);

    expect((await call("POST", "/api/logout", {}, token)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, token)).status).toBe(401);
  });
});
