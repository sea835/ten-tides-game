// Chuỗi hạ gục (thuần, không đụng React hay âm thanh, để thử được): hạ liên tiếp trong một khoảng ngắn thì
// DOUBLE / TRIPLE / MULTI KILL / RAMPAGE; hạ nhiều trong một mạng (chưa chết lần nào) thì mốc 5, 10, 15...

/** Hai lần hạ cách nhau không quá chừng này (ms) thì tính là một chuỗi liên hoàn. */
export const CHAIN_WINDOW = 4000;

export interface StreakState {
  /** Mốc lần hạ gần nhất (ms), 0 = chưa hạ ai. */
  last: number;
  /** Số mạng trong chuỗi liên hoàn đang chạy. */
  chain: number;
  /** Số mạng hạ được trong mạng sống hiện tại. */
  life: number;
}

/** Bậc thông báo: càng cao càng to, càng rực (CSS và tiếng chuông theo bậc). */
export type CalloutTier = 1 | 2 | 3 | 4 | 5;

export interface Callout {
  /** Dòng chữ lớn (tiếng Anh cho chất game bắn súng). */
  title: string;
  /** Dòng phụ tiếng Việt. */
  sub: string;
  tier: CalloutTier;
}

export function newStreak(): StreakState {
  return { last: 0, chain: 0, life: 0 };
}

/** Thông báo theo số mạng trong chuỗi liên hoàn (1 mạng thì không có gì). */
export function chainCallout(chain: number): Callout | null {
  if (chain < 2) return null;
  if (chain === 2) return { title: "DOUBLE KILL", sub: "Hạ kép", tier: 1 };
  if (chain === 3) return { title: "TRIPLE KILL", sub: "Hạ ba", tier: 2 };
  if (chain === 4) return { title: "MULTI KILL", sub: "Liên hoàn", tier: 3 };
  return { title: "RAMPAGE!", sub: `Cuồng sát · ${chain} mạng`, tier: 4 };
}

/** Mốc chuỗi trong một mạng: 5, 10, rồi mỗi 5 mạng sau đó. */
export function lifeCallout(life: number): Callout | null {
  if (life < 5 || life % 5 !== 0) return null;
  if (life === 5) return { title: "KHÔNG THỂ CẢN PHÁ", sub: "Unstoppable · 5 mạng không chết", tier: 4 };
  if (life === 10) return { title: "BẤT KHẢ CHIẾN BẠI", sub: "Godlike · 10 mạng không chết", tier: 5 };
  return { title: "HUYỀN THOẠI", sub: `Legendary · ${life} mạng không chết`, tier: 5 };
}

/**
 * Ghi `n` mạng vừa hạ lúc `at` (ms; phá nổ xe có người có thể là nhiều mạng một lúc), trả về trạng thái mới và
 * thông báo cần hiện. Mốc chuỗi trong mạng thắng chuỗi liên hoàn cùng bậc trở xuống; chuỗi liên hoàn khi đó thành
 * dòng phụ để không mất thông tin.
 */
export function registerKill(s: StreakState, at: number, n = 1): { state: StreakState; callout: Callout | null } {
  if (n <= 0) return { state: s, callout: null };
  const chain = s.last > 0 && at - s.last <= CHAIN_WINDOW ? s.chain + n : n;
  const lifeBefore = s.life;
  const life = s.life + n;
  const state: StreakState = { last: at, chain, life };
  // Nhiều mạng một lúc có thể nhảy qua mốc (4 → 6): vẫn báo mốc vừa vượt.
  let milestone: Callout | null = null;
  for (let k = life; k > lifeBefore; k--) {
    milestone = lifeCallout(k);
    if (milestone) break;
  }
  const combo = chainCallout(chain);
  if (milestone && (!combo || milestone.tier >= combo.tier)) {
    return { state, callout: combo ? { ...milestone, sub: `${combo.title} · ${milestone.sub}` } : milestone };
  }
  return { state, callout: combo };
}

/** Chết thì mất chuỗi trong mạng (chuỗi liên hoàn cũng mất theo). */
export function resetLife(s: StreakState): StreakState {
  return s.life === 0 && s.chain === 0 ? s : { last: 0, chain: 0, life: 0 };
}
