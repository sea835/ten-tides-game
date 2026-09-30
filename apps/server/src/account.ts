import type { JoinOptions, PlayerState } from "@tentides/protocol";
import { equippedSkins, userFromSession } from "./db/accounts.ts";
import { accountsEnabled } from "./db/pool.ts";
import { playerIdFromToken } from "./identity.ts";

// Gắn người vào phòng với tài khoản: có phiên đăng nhập hợp lệ thì id người chơi cố định theo tài khoản
// (u<id>, vào lại từ máy khác vẫn đúng nhân vật), tên là tên tài khoản, skin súng nạp từ database.
// Không có phiên, phiên sai, database lỗi: chơi như khách, y như trước.

export interface Identity {
  playerId: string;
  name: string;
  /** Id tài khoản, null là khách. */
  userId: number | null;
  /** Skin đang lắp (id súng → id skin). */
  skins: Record<string, string>;
}

/** Id người chơi của một tài khoản. Không trùng được với id khách (khách là 12 ký tự hex). */
export function accountPlayerId(userId: number): string {
  return `u${userId}`;
}

/** Id tài khoản suy từ id người chơi, null nếu là khách hay máy. */
export function userIdOfPlayer(playerId: string): number | null {
  const m = /^u(\d+)$/.exec(playerId);
  return m ? Number(m[1]) : null;
}

export async function resolveIdentity(auth: JoinOptions): Promise<Identity> {
  const guest: Identity = { playerId: playerIdFromToken(auth.token), name: auth.name, userId: null, skins: {} };
  if (!auth.session || !accountsEnabled()) return guest;
  try {
    const user = await userFromSession(auth.session);
    if (!user) return guest;
    return { playerId: accountPlayerId(user.id), name: user.username, userId: user.id, skins: await equippedSkins(user.id) };
  } catch (err) {
    console.warn("Không đọc được tài khoản khi vào phòng, cho chơi như khách:", err instanceof Error ? err.message : err);
    return guest;
  }
}

/** Chép skin đang lắp vào state của người chơi. */
export function applySkins(p: PlayerState, skins: Record<string, string>) {
  p.skins.clear();
  for (const [weapon, skin] of Object.entries(skins)) p.skins.set(weapon, skin);
}
