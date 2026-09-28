// Danh hiệu cuối ván: vui là chính, không ảnh hưởng thắng thua. Tính từ những gì người chơi làm trên đảo
// (server đếm lúc chơi) và từ nhật ký của engine (easter egg, bẫy, bị thú cắn, trang nhật ký).

import type { GameState } from "@tentides/rules";

export const FEATS = ["damage", "hurt", "beasts", "trees", "planted", "falls", "throws", "built", "climbs", "cooked", "stashed"] as const;
export type Feat = (typeof FEATS)[number];
export type Feats = Partial<Record<Feat, number>>;

/** Những con số lấy từ nhật ký của engine. */
type LogFeat = "eggs" | "traps" | "bitten" | "pages" | "friends";

interface AwardDef {
  feat: Feat | LogFeat;
  title: string;
  detail: (n: number) => string;
  /** Cần ít nhất chừng này mới trao. */
  min?: number;
}

/** Thứ tự ưu tiên: mỗi người nhận tối đa một danh hiệu, danh hiệu đứng trước được xét trước. */
const AWARDS: readonly AwardDef[] = [
  { feat: "beasts", title: "Thợ săn", detail: (n) => `hạ ${n} con thú` },
  { feat: "trees", title: "Tiều phu", detail: (n) => `đốn ${n} cây` },
  { feat: "damage", title: "Tay đấm máu mặt", detail: (n) => `gây ${n} sát thương`, min: 15 },
  { feat: "falls", title: "Bạn thân của trọng lực", detail: (n) => `té từ trên cây ${n} lần` },
  { feat: "built", title: "Kiến trúc sư", detail: (n) => `dựng ${n} công trình` },
  { feat: "pages", title: "Nhà sử học", detail: (n) => `nhặt ${n} trang nhật ký` },
  { feat: "stashed", title: "Người nuôi cả trại", detail: (n) => `góp ${n} khẩu phần` },
  { feat: "cooked", title: "Đầu bếp đảo hoang", detail: (n) => `nướng ${n} món` },
  { feat: "planted", title: "Người trồng rừng", detail: (n) => `trồng ${n} cây` },
  { feat: "eggs", title: "Kẻ tò mò", detail: (n) => `tìm ra ${n} bí mật` },
  { feat: "traps", title: "Nam châm hút bẫy", detail: (n) => `sập ${n} cái bẫy` },
  { feat: "bitten", title: "Món khoái khẩu của thú dữ", detail: (n) => `bị cắn ${n} lần`, min: 2 },
  { feat: "throws", title: "Vua ném đồ", detail: (n) => `ném ${n} lần`, min: 3 },
  { feat: "climbs", title: "Khỉ đột", detail: (n) => `leo ${n} cây`, min: 2 },
  { feat: "friends", title: "Người thì thầm với muông thú", detail: (n) => `làm quen ${n} lần` },
  { feat: "hurt", title: "Bao cát của cả đoàn", detail: (n) => `lĩnh ${n} sát thương`, min: 15 },
];

function logFeats(game: GameState, playerId: string): Record<LogFeat, number> {
  const out: Record<LogFeat, number> = { eggs: 0, traps: 0, bitten: 0, pages: 0, friends: 0 };
  for (const e of game.log) {
    if (e.kind !== "encounter" || e.playerId !== playerId) continue;
    if (e.source === "egg" || e.source === "anomaly") out.eggs++;
    else if (e.source === "trap" && !e.dodged) out.traps++;
    else if (e.source === "creature") out.bitten++;
    else if (e.source === "page") out.pages++;
    else if (e.source === "friend") out.friends++;
  }
  return out;
}

export interface AwardResult {
  playerId: string;
  title: string;
  detail: string;
}

/** Trao danh hiệu: mỗi danh hiệu cho người làm nhiều nhất (hoà thì người vào phòng trước), mỗi người một danh hiệu. */
export function computeAwards(game: GameState, feats: ReadonlyMap<string, Feats>): AwardResult[] {
  const out: AwardResult[] = [];
  const given = new Set<string>();
  const fromLog = new Map(game.playerOrder.map((id) => [id, logFeats(game, id)]));
  const value = (id: string, feat: AwardDef["feat"]): number => {
    const logged = fromLog.get(id)!;
    return feat in logged ? logged[feat as LogFeat] : (feats.get(id)?.[feat as Feat] ?? 0);
  };
  for (const award of AWARDS) {
    let best: { id: string; n: number } | null = null;
    for (const id of game.playerOrder) {
      if (given.has(id)) continue;
      const n = Math.round(value(id, award.feat));
      if (n >= (award.min ?? 1) && (!best || n > best.n)) best = { id, n };
    }
    if (!best) continue;
    given.add(best.id);
    out.push({ playerId: best.id, title: award.title, detail: award.detail(best.n) });
  }
  return out;
}
