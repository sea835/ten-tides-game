import { battleMap, type BattleMap } from "./battle.ts";
import { warMap } from "./war.ts";
import { assembleWarMap, type WarMapDef } from "./warKit.ts";
import { DIENBIEN } from "./warDienBien.ts";
import { NORMANDY } from "./warNormandy.ts";
import { VERDUN } from "./warVerdun.ts";
import { STALINGRAD } from "./warStalingrad.ts";
import { ALAMEIN } from "./warAlamein.ts";
import { navalMap } from "./naval.ts";

// Danh mục bản đồ chiến trường 50 vs 50: chủ phòng chọn ở sảnh (RoomSettingsState.warMap). Mỗi bản đồ dựng lại một
// trận đánh nổi tiếng với địa hình riêng; seed chỉ đổi cây cối, cỏ, mìn.

export interface WarMapInfo {
  id: string;
  name: string;
  /** Nơi, năm của trận đánh. */
  place: string;
  /** Mô tả ngắn cho sảnh chờ. */
  brief: string;
  /** Kiểu địa hình (nhãn ngắn). */
  terrain: string;
  /** Trận đánh lịch sử một bên đánh, một bên giữ (không có là hai phe ngang nhau, xuất phát như nhau). */
  roles?: WarRoles;
}

/**
 * Bản đồ bất đối xứng: phe tấn công, và những cứ điểm phe phòng thủ giữ sẵn lúc vào trận (phía mình trên bản đồ).
 * Phe phòng thủ xuất phát với lợi thế cứ điểm nên ít vé hơn (DEFENDER_TICKETS).
 */
export interface WarRoles {
  attacker: "blue" | "red";
  held: readonly string[];
}

/** Phe phòng thủ có chừng này phần vé quân của phe tấn công (giữ sẵn cứ điểm là đã hơn thế). */
export const DEFENDER_TICKETS = 0.8;

export const WAR_MAP_LIST: readonly WarMapInfo[] = [
  { id: "frontier", name: "Tiền Tuyến Sông Xanh", place: "Bản đồ gốc", terrain: "Đồi, sông, thị trấn", brief: "Đồi thoải, rừng từng cụm, con sông chảy giữa hai phe (qua cầu hay khúc cạn), thị trấn trung tâm phố hẹp, pháo đài đá, nhà máy xi măng bên bờ biển." },
  { id: "dienbien", name: "Lòng Chảo Điện Biên", place: "Điện Biên Phủ, Việt Nam · 1954", terrain: "Thung lũng, rừng rậm", brief: "Lòng chảo Mường Thanh giữa vòng núi rừng rậm, sông Nậm Rốm cạn lội qua được. Đồi Him Lam, Độc Lập, A1 với lô cốt, hầm ngầm; hầm chỉ huy Đờ Cát, sân bay Mường Thanh; chiến hào răng cưa bao vây khắp lòng chảo. Phe Xanh tấn công từ vòng núi; phe Đỏ cố thủ Him Lam, đồi A1 và Hồng Cúm.", roles: { attacker: "blue", held: ["A", "C", "F"] } },
  { id: "normandy", name: "Bãi Omaha", place: "Normandy, Pháp · 1944", terrain: "Bãi biển, vách đá, bocage", brief: "Phe Xanh đổ bộ lên bãi cát đầy nhím thép, tiến lên vách đá qua ba hẻm; phe Đỏ giữ Bức tường Đại Tây Dương: ụ pháo 88 ly, lô cốt, chiến hào dọc mép vách, mũi Hoc chi chít hố bom, đồng ruộng chia ô bởi bờ giậu.", roles: { attacker: "blue", held: ["E", "F", "G"] } },
  { id: "verdun", name: "Địa Ngục Verdun", place: "Verdun, Pháp · 1916", terrain: "Hố bom, chiến hào, pháo đài", brief: "Vùng đất không người chi chít hố đạn pháo giữa hai hệ thống chiến hào Thế chiến I (tiền tuyến, hào yểm trợ, hào giao thông, dây thép gai). Pháo đài Douaumont có hào sâu bao quanh, pháo đài Vaux, làng Fleury đổ nát." },
  { id: "stalingrad", name: "Thành Phố Stalingrad", place: "Stalingrad, Liên Xô · 1942", terrain: "Thành phố đổ nát, tuyết", brief: "Thành phố đổ nát phủ tuyết bên sông Volga: đồi Mamayev Kurgan, Nhà Pavlov, kho thóc khổng lồ, nhà máy Tháng Mười Đỏ, ga xe lửa trên đường sắt đắp cao, khe núi cắt ngang thành phố. Đánh nhau từng nhà, từng tầng. Phe Xanh tiến từ thảo nguyên; phe Đỏ bám bờ sông, giữ nhà máy, Nhà Pavlov, kho thóc.", roles: { attacker: "blue", held: ["B", "D", "E"] } },
  { id: "alamein", name: "Sa Mạc El Alamein", place: "El Alamein, Ai Cập · 1942", terrain: "Sa mạc, đụn cát, bãi mìn", brief: "Biển cát gợn sóng ven Địa Trung Hải: sống núi đá Ruweisat, ốc đảo và pháo đài Bir Hakeim, pháo đài sa mạc bốn tháp, ga El Alamein, cảng Mersa. Hai dải bãi mìn \"Vườn Quỷ\" chỉ chừa vài lối mở cho xe tăng." },
];

const DEFS: Record<string, WarMapDef> = { dienbien: DIENBIEN, normandy: NORMANDY, verdun: VERDUN, stalingrad: STALINGRAD, alamein: ALAMEIN };

/** Mã bản đồ hợp lệ (không có thì về bản đồ gốc). */
export function warMapId(id: string | undefined): string {
  return id && WAR_MAP_LIST.some((m) => m.id === id) ? id : "frontier";
}

/** Vai hai phe trên bản đồ (undefined là bản đồ đối xứng). */
export function warRoles(id: string | undefined): WarRoles | undefined {
  return WAR_MAP_LIST.find((m) => m.id === warMapId(id))?.roles;
}

/** Phe `side` tấn công hay phòng thủ trên bản đồ `id` ("" là bản đồ đối xứng). */
export function warRoleOf(id: string | undefined, side: string): "attack" | "defend" | "" {
  const r = warRoles(id);
  if (!r || (side !== "blue" && side !== "red")) return "";
  return r.attacker === side ? "attack" : "defend";
}

/** Bản đồ chiến trường theo mã. */
export function warMapById(id: string | undefined, seed: number): BattleMap {
  const key = warMapId(id);
  const def = DEFS[key];
  return def ? assembleWarMap(def, seed || 1) : warMap(seed || 1);
}

/** Bản đồ theo chế độ trận: chiến trường 50 vs 50 (theo mã bản đồ) hay đảo sinh tồn / đồng đội. */
export function mapForMode(mode: string, seed: number, mapId?: string): BattleMap {
  if (mode === "naval") return navalMap(seed || 1);
  return mode === "war" ? warMapById(mapId, seed) : battleMap(seed || 1);
}

/** Bản đồ của phòng theo trạng thái (chế độ, seed, bản đồ chiến trường chủ phòng chọn). */
export function mapForState(s: { battleMode: string; worldSeed: number; settings?: { warMap?: string } }): BattleMap {
  return mapForMode(s.battleMode, s.worldSeed, s.settings?.warMap);
}
