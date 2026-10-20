import { matchMaker } from "@colyseus/core";
import { JoinOptions } from "@tentides/protocol";
import { resolveIdentity, type Identity } from "./account.ts";
import { randomRoomCode } from "./roomCode.ts";

// Phần dùng chung của IslandRoom và BattleRoom: mã phòng không trùng, và bước đầu của onAuth (đọc tuỳ chọn, gắn với
// tài khoản hay khách, chặn người bị chủ phòng mời ra). Mỗi phòng tự thêm luật riêng (ván đã bắt đầu, phòng đầy).

/** Mã phòng 4 ký tự chưa phòng nào đang dùng (thử lại vài lần nếu trùng). */
export async function uniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomRoomCode();
    if (!(await matchMaker.getRoomById(code))) return code;
  }
  throw new Error("Không tạo được mã phòng mới");
}

/** Tuỳ chọn người vào gắn với danh tính (tài khoản hay khách); ném lỗi nếu người này đã bị chủ phòng mời ra. */
export async function authenticate(options: unknown, kicked: ReadonlySet<string>): Promise<{ auth: JoinOptions; identity: Identity }> {
  const auth = JoinOptions.parse(options);
  // Có phiên đăng nhập hợp lệ thì gắn với tài khoản (id u<id>, tên tài khoản, skin), không thì là khách như cũ.
  const identity = await resolveIdentity(auth);
  if (kicked.has(identity.playerId)) throw new Error("Chủ phòng đã mời bạn ra khỏi phòng này.");
  return { auth, identity };
}
