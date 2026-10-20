import { randomBytes } from "node:crypto";
import {
  CALLING_CARD,
  EMBLEM,
  EMPTY_LOADOUT,
  LOADOUT_SLOTS,
  SKIN,
  COIN_RULES,
  canUseCard,
  canUseEmblem,
  capDailyCoins,
  checkCraft,
  dayKey,
  dupeShards,
  gachaCost,
  rankOf,
  rollSkins,
  skinFitsWeapon,
  type RollResult,
  type StatTally,
  type WeaponLoadout,
} from "@tentides/content";
import type { RewardChallenge } from "@tentides/protocol";
import { recordStatsTx } from "./challenges.ts";
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
  /** Mảnh skin (quay trùng ra mảnh, đổi mảnh lấy skin). */
  shards: number;
  /** Quân hàm: tổng XP, quân hàm 1–30, thẻ tên và huy hiệu đang lắp. */
  progress: Progress;
  /** Gunsmith: bộ phụ kiện ưa thích theo từng khẩu. */
  loadouts: Record<string, WeaponLoadout>;
}

export interface Progress {
  xp: number;
  rank: number;
  card: string;
  emblem: string;
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
  const [u, skins, equipped, loadouts] = await Promise.all([
    db().query<UserRow & ProgressRow & { pity_epic: number; pity_legendary: number; shards: number }>(
      "SELECT id, username, coins, pity_epic, pity_legendary, shards, xp, calling_card, emblem FROM users WHERE id = $1",
      [userId],
    ),
    db().query<{ skin_id: string; count: number }>("SELECT skin_id, count FROM user_skins WHERE user_id = $1 AND count > 0 ORDER BY obtained_at", [userId]),
    equippedSkins(userId),
    weaponLoadouts(userId),
  ]);
  const row = u.rows[0];
  if (!row) throw new AccountError("unauthorized", 401, "Phiên đăng nhập không còn hợp lệ.");
  return {
    user: toUser(row),
    skins: skins.rows.filter((r) => SKIN.has(r.skin_id)).map((r) => ({ skinId: r.skin_id, count: r.count })),
    equipped,
    pity: { sinceEpic: row.pity_epic, sinceLegendary: row.pity_legendary },
    shards: row.shards,
    progress: toProgress(row),
    loadouts,
  };
}

// ---------------------------------------------------------------------------- quân hàm, thẻ tên, huy hiệu

interface ProgressRow {
  /** bigint: pg trả về chuỗi. */
  xp: string | number;
  calling_card: string;
  emblem: string;
}

function toProgress(r: ProgressRow): Progress {
  const xp = Number(r.xp) || 0;
  // Thẻ hay huy hiệu đã bị bỏ khỏi danh mục thì coi như chưa lắp.
  return { xp, rank: rankOf(xp), card: CALLING_CARD.has(r.calling_card) ? r.calling_card : "", emblem: EMBLEM.has(r.emblem) ? r.emblem : "" };
}

/** XP, quân hàm, thẻ tên, huy hiệu của một tài khoản (để chép vào PlayerState khi vào phòng). */
export async function playerProgress(userId: number): Promise<Progress> {
  const { rows } = await db().query<ProgressRow>("SELECT xp, calling_card, emblem FROM users WHERE id = $1", [userId]);
  return rows[0] ? toProgress(rows[0]) : { xp: 0, rank: 1, card: "", emblem: "" };
}

/** Lắp thẻ tên và huy hiệu (rỗng là bỏ). Phải đã mở khoá: đạt quân hàm, hay có đủ skin. */
export async function equipCard(userId: number, cardId: string, emblemId: string): Promise<Progress> {
  const [p, owned] = await Promise.all([
    playerProgress(userId),
    db().query<{ skin_id: string }>("SELECT skin_id FROM user_skins WHERE user_id = $1 AND count > 0", [userId]),
  ]);
  const skins = owned.rows.map((r) => r.skin_id);
  if (!canUseCard(cardId, p.rank, skins)) throw new AccountError("locked", 403, "Thẻ tên này chưa mở khoá.");
  if (!canUseEmblem(emblemId, p.rank, skins)) throw new AccountError("locked", 403, "Huy hiệu này chưa mở khoá.");
  await db().query("UPDATE users SET calling_card = $2, emblem = $3 WHERE id = $1", [userId, cardId, emblemId]);
  return { ...p, card: cardId, emblem: emblemId };
}

/** Cộng XP (ngoài phần ghi kèm kết quả trận), vd. khi phòng đóng giữa trận. */
export async function addXp(rows: readonly { userId: number; xp: number }[]): Promise<void> {
  const list = rows.filter((r) => r.xp > 0);
  if (!accountsEnabled() || list.length === 0) return;
  await transaction(async (c) => {
    for (const r of list) await c.query("UPDATE users SET xp = xp + $2 WHERE id = $1", [r.userId, Math.floor(r.xp)]);
  });
}

// ---------------------------------------------------------------------------- Gunsmith

type LoadoutRow = { weapon_id: string } & WeaponLoadout;

export async function weaponLoadouts(userId: number): Promise<Record<string, WeaponLoadout>> {
  const { rows } = await db().query<LoadoutRow>("SELECT weapon_id, muzzle, grip, mag, stock, sight FROM weapon_loadouts WHERE user_id = $1", [userId]);
  const out: Record<string, WeaponLoadout> = {};
  for (const r of rows) {
    const l: WeaponLoadout = { ...EMPTY_LOADOUT };
    for (const slot of LOADOUT_SLOTS) l[slot] = r[slot] ?? "";
    out[r.weapon_id] = l;
  }
  return out;
}

/** Lưu bộ phụ kiện của một khẩu (đã kiểm tra bằng validateLoadout ở API). Bộ toàn ô trống thì xoá dòng. */
export async function saveLoadout(userId: number, weaponId: string, l: WeaponLoadout): Promise<Record<string, WeaponLoadout>> {
  if (LOADOUT_SLOTS.every((s) => !l[s])) {
    await db().query("DELETE FROM weapon_loadouts WHERE user_id = $1 AND weapon_id = $2", [userId, weaponId]);
  } else {
    await db().query(
      `INSERT INTO weapon_loadouts (user_id, weapon_id, muzzle, grip, mag, stock, sight) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, weapon_id) DO UPDATE SET muzzle = EXCLUDED.muzzle, grip = EXCLUDED.grip, mag = EXCLUDED.mag,
         stock = EXCLUDED.stock, sight = EXCLUDED.sight, updated_at = now()`,
      [userId, weaponId, l.muzzle, l.grip, l.mag, l.stock, l.sight],
    );
  }
  return weaponLoadouts(userId);
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
  /** `shards`: số mảnh lượt này ra (skin trùng), 0 nếu là skin mới. */
  results: (RollResult & { count: number; isNew: boolean; shards: number })[];
  coins: number;
  pity: { sinceEpic: number; sinceLegendary: number };
  /** Số mảnh sau lượt quay. */
  shards: number;
}

/** Ngẫu nhiên dùng cho gacha thật: crypto, không đoán trước được. */
const cryptoRandom = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

export async function rollGacha(userId: number, count: 1 | 10, rng: () => number = cryptoRandom): Promise<RollOutcome> {
  const cost = gachaCost(count);
  return transaction(async (c) => {
    // Khoá dòng người dùng: hai lần bấm quay cùng lúc không trừ xu hay đếm bảo hiểm sai.
    const { rows } = await c.query<{ coins: number; pity_epic: number; pity_legendary: number; shards: number }>(
      "SELECT coins, pity_epic, pity_legendary, shards FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const u = rows[0];
    if (!u) throw new AccountError("unauthorized", 401, "Phiên đăng nhập không còn hợp lệ.");
    if (u.coins < cost) throw new AccountError("not_enough_coins", 402, `Không đủ xu (cần ${cost}).`);
    const rolled = rollSkins(count, { sinceEpic: u.pity_epic, sinceLegendary: u.pity_legendary }, rng);
    const coins = u.coins - cost;
    await c.query("UPDATE users SET coins = $2, pity_epic = $3, pity_legendary = $4 WHERE id = $1", [userId, coins, rolled.pity.sinceEpic, rolled.pity.sinceLegendary]);
    const results: RollOutcome["results"] = [];
    const each = Math.round(cost / count);
    let shards = u.shards;
    for (const r of rolled.results) {
      const up = await c.query<{ count: number }>(
        "INSERT INTO user_skins (user_id, skin_id, count) VALUES ($1, $2, 1) ON CONFLICT (user_id, skin_id) DO UPDATE SET count = user_skins.count + 1 RETURNING count",
        [userId, r.skinId],
      );
      const total = up.rows[0]!.count;
      // Skin trùng: đổi ra mảnh theo độ hiếm (count vẫn tăng để biết đã trùng bao nhiêu lần).
      const got = dupeShards(r.rarity, total);
      shards += got;
      await c.query("INSERT INTO gacha_rolls (user_id, skin_id, rarity, cost, shards) VALUES ($1, $2, $3, $4, $5)", [userId, r.skinId, r.rarity, each, got]);
      results.push({ ...r, count: total, isNew: total === 1, shards: got });
    }
    if (shards !== u.shards) await c.query("UPDATE users SET shards = $2 WHERE id = $1", [userId, shards]);
    return { results, coins, pity: rolled.pity, shards };
  });
}

/** Đổi mảnh lấy một skin chọn sẵn (chưa có trong kho). Trả về số mảnh còn lại. */
export async function craftSkin(userId: number, skinId: string): Promise<{ skinId: string; shards: number }> {
  return transaction(async (c) => {
    // Khoá dòng người dùng: hai lần bấm đổi cùng lúc không trừ mảnh hai lần.
    const { rows } = await c.query<{ shards: number }>("SELECT shards FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const u = rows[0];
    if (!u) throw new AccountError("unauthorized", 401, "Phiên đăng nhập không còn hợp lệ.");
    const owned = await c.query<{ count: number }>("SELECT count FROM user_skins WHERE user_id = $1 AND skin_id = $2", [userId, skinId]);
    const check = checkCraft(skinId, owned.rows[0]?.count ?? 0, u.shards);
    if (!check.ok) throw new AccountError(check.code, check.code === "not_enough_shards" ? 402 : check.code === "owned" ? 409 : 400, check.reason);
    const shards = u.shards - check.cost;
    await c.query("UPDATE users SET shards = $2 WHERE id = $1", [userId, shards]);
    await c.query(
      "INSERT INTO user_skins (user_id, skin_id, count) VALUES ($1, $2, 1) ON CONFLICT (user_id, skin_id) DO UPDATE SET count = user_skins.count + 1",
      [userId, skinId],
    );
    await c.query("INSERT INTO skin_crafts (user_id, skin_id, shards) VALUES ($1, $2, $3)", [userId, skinId, check.cost]);
    return { skinId, shards };
  });
}

// ---------------------------------------------------------------------------- thưởng sau trận

export interface MatchReward {
  userId: number;
  kills: number;
  placement: number;
  /** Xu trận (đã nhân hệ số phòng một người), chưa áp giới hạn ngày. */
  coins: number;
  /** XP kiếm được trong trận (hạ gục, chiếm cứ điểm...). */
  xp?: number;
  /** Số liệu trận cho thử thách ngày / tuần. */
  stats?: StatTally;
}

/** Kết quả đã ghi của một người: xu trận thực nhận, có chạm giới hạn ngày không, thử thách vừa xong. */
export interface RecordedReward {
  userId: number;
  coins: number;
  /** Xu trận trước khi áp giới hạn ngày. */
  earned: number;
  capped: boolean;
  /** Xu trận đã nhận hôm nay, sau trận này. */
  today: number;
  challenges: RewardChallenge[];
}

/**
 * Cộng xu (áp giới hạn xu mỗi ngày), XP, ghi kết quả trận và tiến độ thử thách (thử thách xong tự nhận thưởng, không
 * tính vào giới hạn). Không có database thì bỏ qua. Khoá dòng người dùng theo thứ tự id để hai phòng cùng ghi không
 * kẹt lẫn nhau.
 */
export async function recordMatch(mode: string, rewards: readonly MatchReward[], now = Date.now()): Promise<RecordedReward[]> {
  if (!accountsEnabled() || rewards.length === 0) return [];
  const today = dayKey(now);
  return transaction(async (c) => {
    const out: RecordedReward[] = [];
    for (const r of [...rewards].sort((a, b) => a.userId - b.userId)) {
      const { rows } = await c.query<{ coin_day: string; coins_today: number }>("SELECT coin_day, coins_today FROM users WHERE id = $1 FOR UPDATE", [r.userId]);
      const u = rows[0];
      if (!u) continue;
      const before = u.coin_day === today ? u.coins_today : 0;
      const { granted, capped } = capDailyCoins(r.coins, before, COIN_RULES.dailyCap);
      const xp = Math.max(0, Math.floor(r.xp ?? 0));
      await c.query("UPDATE users SET coins = coins + $2, xp = xp + $3, coin_day = $4, coins_today = $5 WHERE id = $1", [r.userId, granted, xp, today, before + granted]);
      await c.query("INSERT INTO match_results (user_id, mode, kills, placement, coins_earned, xp_earned) VALUES ($1, $2, $3, $4, $5, $6)", [
        r.userId,
        mode,
        r.kills,
        r.placement,
        granted,
        xp,
      ]);
      const challenges = r.stats ? await recordStatsTx(c, r.userId, r.stats, now) : [];
      out.push({ userId: r.userId, coins: granted, earned: Math.max(0, Math.floor(r.coins)), capped, today: before + granted, challenges });
    }
    return out;
  });
}
