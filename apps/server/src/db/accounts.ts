import { randomBytes } from "node:crypto";
import { SKIN, gachaCost, rollSkins, skinFitsWeapon, type RollResult } from "@tentides/content";
import { accountsEnabled, db, transaction } from "./pool.ts";
import { SESSION_DAYS, burnPasswordCheck, hashPassword, hashSessionToken, newSessionToken, verifyPassword } from "./password.ts";

// Mọi truy vấn tài khoản: đăng ký, đăng nhập, phiên, kho skin, gacha, thưởng xu sau trận.

export interface PublicUser {
  id: number;
  username: string;
  coins: number;
}

export interface Profile {
  user: PublicUser;
  skins: { skinId: string; count: number }[];
  equipped: Record<string, string>;
  pity: { sinceEpic: number; sinceLegendary: number };
}

/** Lỗi có mã để API trả về đúng mã HTTP và thông báo. */
export class AccountError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface UserRow {
  id: string;
  username: string;
  coins: number;
}

const toUser = (r: UserRow): PublicUser => ({ id: Number(r.id), username: r.username, coins: r.coins });

// ---------------------------------------------------------------------------- đăng ký, đăng nhập, phiên

async function createSession(userId: number | string): Promise<string> {
  const token = newSessionToken();
  await db().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))", [hashSessionToken(token), userId, SESSION_DAYS]);
  return token;
}

export async function register(username: string, password: string): Promise<{ token: string; user: PublicUser }> {
  const hash = await hashPassword(password);
  try {
    const { rows } = await db().query<UserRow>("INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, coins", [username, hash]);
    const user = rows[0]!;
    return { token: await createSession(user.id), user: toUser(user) };
  } catch (err) {
    // 23505: trùng khoá duy nhất (tên đã có người dùng, không phân biệt hoa thường).
    if ((err as { code?: string }).code === "23505") throw new AccountError("username_taken", 409, "Tên này đã có người dùng.");
    throw err;
  }
}

export async function login(username: string, password: string): Promise<{ token: string; user: PublicUser }> {
  const { rows } = await db().query<UserRow & { password_hash: string }>("SELECT id, username, coins, password_hash FROM users WHERE lower(username) = lower($1)", [username]);
  const row = rows[0];
  if (!row) {
    await burnPasswordCheck(password);
    throw new AccountError("bad_credentials", 401, "Sai tên đăng nhập hoặc mật khẩu.");
  }
  if (!(await verifyPassword(password, row.password_hash))) throw new AccountError("bad_credentials", 401, "Sai tên đăng nhập hoặc mật khẩu.");
  // Dọn phiên hết hạn của người này cho gọn bảng.
  await db().query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()", [row.id]);
  return { token: await createSession(row.id), user: toUser(row) };
}

export async function logout(token: string): Promise<void> {
  await db().query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token)]);
}

/** Người dùng của một token phiên còn hạn, hoặc null. */
export async function userFromSession(token: string): Promise<PublicUser | null> {
  if (!token || token.length > 128) return null;
  const { rows } = await db().query<UserRow>(
    "SELECT u.id, u.username, u.coins FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
    [hashSessionToken(token)],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

// ---------------------------------------------------------------------------- hồ sơ, kho skin

export async function equippedSkins(userId: number): Promise<Record<string, string>> {
  const { rows } = await db().query<{ weapon_id: string; skin_id: string }>("SELECT weapon_id, skin_id FROM equipped_skins WHERE user_id = $1", [userId]);
  const out: Record<string, string> = {};
  // Skin đã bị bỏ khỏi danh mục hay không còn hợp súng thì thôi không lắp.
  for (const r of rows) if (skinFitsWeapon(r.skin_id, r.weapon_id)) out[r.weapon_id] = r.skin_id;
  return out;
}

export async function profile(userId: number): Promise<Profile> {
  const [u, skins, equipped] = await Promise.all([
    db().query<UserRow & { pity_epic: number; pity_legendary: number }>("SELECT id, username, coins, pity_epic, pity_legendary FROM users WHERE id = $1", [userId]),
    db().query<{ skin_id: string; count: number }>("SELECT skin_id, count FROM user_skins WHERE user_id = $1 AND count > 0 ORDER BY obtained_at", [userId]),
    equippedSkins(userId),
  ]);
  const row = u.rows[0];
  if (!row) throw new AccountError("unauthorized", 401, "Phiên đăng nhập không còn hợp lệ.");
  return {
    user: toUser(row),
    skins: skins.rows.filter((r) => SKIN.has(r.skin_id)).map((r) => ({ skinId: r.skin_id, count: r.count })),
    equipped,
    pity: { sinceEpic: row.pity_epic, sinceLegendary: row.pity_legendary },
  };
}

/** Lắp skin cho một khẩu (skinId rỗng là tháo). Phải có skin trong kho và skin hợp khẩu đó. */
export async function equipSkin(userId: number, weaponId: string, skinId: string): Promise<Record<string, string>> {
  if (!skinId) {
    await db().query("DELETE FROM equipped_skins WHERE user_id = $1 AND weapon_id = $2", [userId, weaponId]);
    return equippedSkins(userId);
  }
  if (!skinFitsWeapon(skinId, weaponId)) throw new AccountError("skin_mismatch", 400, "Skin này không lắp được lên khẩu đó.");
  const owned = await db().query("SELECT 1 FROM user_skins WHERE user_id = $1 AND skin_id = $2 AND count > 0", [userId, skinId]);
  if (!owned.rowCount) throw new AccountError("not_owned", 403, "Bạn chưa có skin này.");
  await db().query(
    "INSERT INTO equipped_skins (user_id, weapon_id, skin_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, weapon_id) DO UPDATE SET skin_id = EXCLUDED.skin_id",
    [userId, weaponId, skinId],
  );
  return equippedSkins(userId);
}

// ---------------------------------------------------------------------------- gacha

export interface RollOutcome {
  results: (RollResult & { count: number; isNew: boolean })[];
  coins: number;
  pity: { sinceEpic: number; sinceLegendary: number };
}

/** Ngẫu nhiên dùng cho gacha thật: crypto, không đoán trước được. */
const cryptoRandom = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

export async function rollGacha(userId: number, count: 1 | 10, rng: () => number = cryptoRandom): Promise<RollOutcome> {
  const cost = gachaCost(count);
  return transaction(async (c) => {
    // Khoá dòng người dùng: hai lần bấm quay cùng lúc không trừ xu hay đếm bảo hiểm sai.
    const { rows } = await c.query<{ coins: number; pity_epic: number; pity_legendary: number }>("SELECT coins, pity_epic, pity_legendary FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const u = rows[0];
    if (!u) throw new AccountError("unauthorized", 401, "Phiên đăng nhập không còn hợp lệ.");
    if (u.coins < cost) throw new AccountError("not_enough_coins", 402, `Không đủ xu (cần ${cost}).`);
    const rolled = rollSkins(count, { sinceEpic: u.pity_epic, sinceLegendary: u.pity_legendary }, rng);
    const coins = u.coins - cost;
    await c.query("UPDATE users SET coins = $2, pity_epic = $3, pity_legendary = $4 WHERE id = $1", [userId, coins, rolled.pity.sinceEpic, rolled.pity.sinceLegendary]);
    const results: RollOutcome["results"] = [];
    const each = Math.round(cost / count);
    for (const r of rolled.results) {
      const up = await c.query<{ count: number }>(
        "INSERT INTO user_skins (user_id, skin_id, count) VALUES ($1, $2, 1) ON CONFLICT (user_id, skin_id) DO UPDATE SET count = user_skins.count + 1 RETURNING count",
        [userId, r.skinId],
      );
      await c.query("INSERT INTO gacha_rolls (user_id, skin_id, rarity, cost) VALUES ($1, $2, $3, $4)", [userId, r.skinId, r.rarity, each]);
      const total = up.rows[0]!.count;
      results.push({ ...r, count: total, isNew: total === 1 });
    }
    return { results, coins, pity: rolled.pity };
  });
}

// ---------------------------------------------------------------------------- thưởng sau trận

export interface MatchReward {
  userId: number;
  kills: number;
  placement: number;
  coins: number;
}

/** Cộng xu và ghi kết quả trận. Không có database thì bỏ qua. */
export async function recordMatch(mode: string, rewards: readonly MatchReward[]): Promise<void> {
  if (!accountsEnabled() || rewards.length === 0) return;
  await transaction(async (c) => {
    for (const r of rewards) {
      await c.query("UPDATE users SET coins = coins + $2 WHERE id = $1", [r.userId, r.coins]);
      await c.query("INSERT INTO match_results (user_id, mode, kills, placement, coins_earned) VALUES ($1, $2, $3, $4, $5)", [r.userId, mode, r.kills, r.placement, r.coins]);
    }
  });
}
