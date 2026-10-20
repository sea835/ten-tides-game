import { matchMaker } from "@colyseus/core";
import { BATTLE_ROOM_NAME, MAX_PLAYERS, QUICK_MODES, type IslandState, type PublicRoomInfo, type QuickMode, type RoomListingMeta } from "@tentides/protocol";

// Danh sách phòng công khai ("Phòng đang mở") và Chơi nhanh. Phòng Battleground ghi metadata matchmaking của Colyseus
// (chế độ, bản đồ, số người, pha, chủ phòng, công khai không) vài giây một lần khi có đổi; API đọc lại bằng
// matchMaker.query. Phần chọn phòng là hàm thuần để test không cần server.

/** Phòng đồng bộ metadata danh sách chừng này mili giây một lần (chỉ ghi khi có đổi). */
export const LISTING_SYNC_MS = 2000;

/** Metadata danh sách của một phòng, suy từ state. */
export function listingMeta(state: IslandState): RoomListingMeta {
  let humans = 0;
  for (const p of state.players.values()) if (!p.bot) humans++;
  const mode = state.battleMode || "solo";
  const map = mode === "war" ? state.settings.warMap : mode === "naval" ? `${state.settings.shipBlue}:${state.settings.shipRed}` : "";
  return {
    public: state.settings.publicRoom,
    mode,
    map,
    humans,
    max: MAX_PLAYERS,
    phase: state.phase,
    host: state.players.get(state.hostId)?.name ?? "",
  };
}

/**
 * Giữ metadata matchmaking của phòng khớp với state: gọi sync() định kỳ, chỉ ghi (setMetadata, có lưu vào driver)
 * khi khác lần trước. Lỗi ghi chỉ in ra, không làm sập phòng.
 */
export class ListingSync {
  private last = "";

  constructor(private readonly room: { state: IslandState; setMetadata(meta: RoomListingMeta): Promise<unknown> }) {}

  sync() {
    const meta = listingMeta(this.room.state);
    const key = JSON.stringify(meta);
    if (key === this.last) return;
    this.last = key;
    this.room.setMetadata(meta).catch((err: unknown) => {
      this.last = "";
      console.warn("Không cập nhật được danh sách phòng:", err instanceof Error ? err.message : err);
    });
  }
}

export function isQuickMode(m: unknown): m is QuickMode {
  return typeof m === "string" && (QUICK_MODES as readonly string[]).includes(m);
}

/** Phòng tạo từ Chơi nhanh (`{ quick: "war" }` trong tham số tạo phòng): chế độ chọn sẵn, phòng công khai. */
export function quickPlayMode(options: unknown): QuickMode | null {
  const q = (options as { quick?: unknown } | null | undefined)?.quick;
  return isQuickMode(q) ? q : null;
}

/** Dạng tối thiểu của một dòng trong bộ đệm phòng của Colyseus (IRoomCache). */
export interface RoomCacheLike {
  roomId: string;
  name?: string;
  locked?: boolean;
  metadata?: Partial<RoomListingMeta> | null;
}

/** Phòng công khai còn chỗ (hoặc đầy, vẫn hiện để biết) từ bộ đệm phòng: bỏ phòng riêng tư, phòng chưa có metadata. */
export function publicRooms(caches: readonly RoomCacheLike[]): PublicRoomInfo[] {
  const out: PublicRoomInfo[] = [];
  for (const c of caches) {
    const m = c.metadata;
    if (!m || m.public !== true || (c.name && c.name !== BATTLE_ROOM_NAME)) continue;
    const humans = Math.max(0, Math.floor(Number(m.humans) || 0));
    out.push({
      code: c.roomId,
      mode: String(m.mode ?? "solo"),
      map: String(m.map ?? ""),
      // Phòng bị khoá (đủ chỗ kết nối) coi như đầy.
      humans: c.locked ? Math.max(humans, Number(m.max) || MAX_PLAYERS) : humans,
      max: Math.max(1, Math.floor(Number(m.max) || MAX_PLAYERS)),
      phase: String(m.phase ?? "lobby"),
      host: String(m.host ?? ""),
    });
  }
  // Phòng đang ở sảnh lên trước, rồi phòng đông người trước (dễ đủ quân), rồi theo mã cho ổn định.
  return out.sort((a, b) => Number(b.phase === "lobby") - Number(a.phase === "lobby") || b.humans - a.humans || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * Vào giữa trận được không: chiến trường có hồi sinh nên vào lúc đang đánh vẫn chơi được ngay; chế độ khác vào giữa
 * trận chỉ đứng xem (đã gục) nên chỉ nhận phòng còn ở sảnh.
 */
export function joinableMidMatch(mode: string): boolean {
  return mode === "war";
}

/**
 * Chơi nhanh: chọn phòng công khai cùng chế độ còn chỗ, đang ở sảnh (chiến trường thì cả đang đánh). Ưu tiên phòng ở
 * sảnh, rồi phòng đông người nhất (lấp đầy phòng trước khi mở phòng mới). Không có thì null (client tạo phòng mới).
 */
export function pickQuickRoom(rooms: readonly PublicRoomInfo[], mode: string): string | null {
  let best: PublicRoomInfo | null = null;
  const score = (r: PublicRoomInfo) => (r.phase === "lobby" ? 1000 : 0) + r.humans;
  for (const r of rooms) {
    if (r.mode !== mode || r.humans >= r.max) continue;
    const ok = r.phase === "lobby" || (joinableMidMatch(mode) && (r.phase === "prep" || r.phase === "battle"));
    if (!ok) continue;
    if (!best || score(r) > score(best) || (score(r) === score(best) && r.code < best.code)) best = r;
  }
  return best?.code ?? null;
}

/** Phòng công khai đang mở trên server này (đọc bộ đệm matchmaking). */
export async function listPublicRooms(): Promise<PublicRoomInfo[]> {
  const caches = (await matchMaker.query({ name: BATTLE_ROOM_NAME })) as RoomCacheLike[];
  return publicRooms(caches);
}
