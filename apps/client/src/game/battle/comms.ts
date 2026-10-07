import { useSyncExternalStore } from "react";
import { lootLabel } from "@tentides/content";
import type { PingBroadcast, PingKind, PingShownKind, RadioBroadcast, RadioLine } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { bodies } from "./runtime.ts";

// Liên lạc trong đội trên máy mình: các dấu đang hiện (chuột giữa), bảng tin bộ đàm, vòng khẩu lệnh đang mở.
// Dấu sống trong mảng module (cảnh 3D chiếu ra màn hình mỗi khung hình, bản đồ nhỏ đọc lại); bảng tin qua kho nhỏ.

export interface Ping {
  /** Số hiệu dấu (mỗi dấu mới một số, > 0). */
  key: number;
  from: string;
  name: string;
  kind: PingShownKind;
  x: number;
  y: number;
  z: number;
  /** Dấu địch: id người bị đánh dấu (dấu bám theo người đó tới khi hết giờ hay người đó gục). */
  target: string;
  /** Hết hạn lúc nào (performance.now, ms). */
  until: number;
  mine: boolean;
  /** Dấu đồ dưới đất: id món đồ. */
  item: string;
}

/** Tối đa chừng này dấu cùng lúc (mỗi người một dấu: dấu mới thay dấu cũ của cùng người). */
export const MAX_PINGS = 12;
export const pings: Ping[] = [];

/** Các ô dấu trên màn hình (CommsHud dựng sẵn, cảnh 3D đặt vị trí mỗi khung hình). */
export const MARKER_POOL = 16;
export const markerPool: { els: (HTMLDivElement | null)[] } = { els: [] };

/** Chữ trên ô dấu (dấu đồ thì ghép tên món: xem pingText). */
export const PING_LABEL: Record<PingShownKind, string> = {
  spot: "Di chuyển tới đây!",
  enemy: "Phát hiện địch!",
  danger: "Nguy hiểm!",
  spotted: "Trinh sát",
  loot: "Ở đây có đồ!",
  attack: "Tấn công",
  defend: "Phòng thủ",
  coming: "Đang tới",
  armor: "Cần giáp",
  seen: "Nhìn thấy địch",
  careful: "Cẩn thận",
};

/** Biểu tượng từng ô trên vòng chọn (giữ chuột giữa). */
export const PING_ICON: Partial<Record<PingKind, string>> = { attack: "⚔", defend: "⛨", coming: "➜", armor: "🦺", seen: "👁", careful: "⚠" };

/** Chữ của một dấu: dấu đồ dưới đất thì "Ở đây có Giáp cấp 3!". */
export function pingText(kind: PingShownKind, item: string): string {
  return kind === "loot" && item ? `Ở đây có ${lootLabel(item)}!` : PING_LABEL[kind];
}

let pingSeq = 0;

export function addPing(b: PingBroadcast, me: string) {
  // Mỗi người một dấu tự đánh; dấu trinh sát (ống nhòm) thì mỗi mục tiêu một dấu, người trinh sát đánh dấu được nhiều.
  const spotted = b.kind === "spotted";
  const i = pings.findIndex((p) => (spotted ? p.kind === "spotted" && (b.target ? p.target === b.target : Math.hypot(p.x - b.x, p.z - b.z) < 4) : p.from === b.from && p.kind !== "spotted"));
  if (i >= 0) pings.splice(i, 1);
  if (pings.length >= MAX_PINGS) pings.shift();
  pings.push({ key: ++pingSeq, from: b.from, name: b.name, kind: b.kind, x: b.x, y: b.y, z: b.z, target: b.target, until: performance.now() + b.ttl, mine: b.from === me, item: b.item ?? "" });
}

/** Bỏ dấu hết hạn; dấu địch bám theo vị trí đang vẽ của người bị đánh dấu (gục thì thôi bám). */
export function updatePings(now: number) {
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i]!;
    if (now > p.until) {
      pings.splice(i, 1);
      continue;
    }
    if (!p.target) continue;
    const b = bodies.get(p.target);
    if (b && b.alive) {
      p.x = b.x;
      p.y = b.y;
      p.z = b.z;
    } else p.target = "";
  }
}

// ---------------------------------------------------------------------------- vòng chọn dấu (giữ chuột giữa)

/** Giữ chuột giữa lâu hơn chừng này (ms) thì mở vòng chọn; thả sớm hơn là dấu theo ngữ cảnh. */
export const PING_HOLD_MS = 220;

/** Vòng chọn dấu đang mở không, ô nào đang chọn (CommsWorld ghi, CommsHud vẽ). */
let wheelState = { open: false, pick: -1 };
const wheelListeners = new Set<() => void>();

export function setPingWheel(open: boolean, pick: number) {
  if (wheelState.open === open && wheelState.pick === pick) return;
  wheelState = { open, pick };
  wheelListeners.forEach((l) => l());
}

export function pingWheelOpen(): boolean {
  return wheelState.open;
}

export function usePingWheel(): { open: boolean; pick: number } {
  return useSyncExternalStore(
    (l) => {
      wheelListeners.add(l);
      return () => wheelListeners.delete(l);
    },
    () => wheelState,
  );
}

/** Ô vòng (n ô, ô 0 ở trên cùng, theo chiều kim đồng hồ) theo chuột đã đi (dx, dy); trong vùng chết thì -1. */
export function wheelSlice(dx: number, dy: number, n: number, dead: number): number {
  if (Math.hypot(dx, dy) <= dead) return -1;
  const a = Math.atan2(dx, -dy);
  return ((Math.round(a / ((Math.PI * 2) / n)) % n) + n) % n;
}

// ---------------------------------------------------------------------------- bộ đàm

/** Tám câu trên vòng khẩu lệnh, theo thứ tự chiều kim đồng hồ từ trên cùng. */
export const RADIO_WHEEL: readonly RadioLine[] = ["help", "ammo", "medic", "attack", "ack", "defend", "retreat", "thanks"];
export const RADIO_TEXT: Record<RadioLine, string> = {
  help: "Cần hỗ trợ",
  ammo: "Cần đạn",
  medic: "Cần y tế",
  attack: "Tấn công cứ điểm",
  defend: "Phòng thủ cứ điểm",
  ack: "Rõ / Đã hiểu",
  retreat: "Rút lui",
  thanks: "Cảm ơn",
};
export const RADIO_ICON: Record<RadioLine, string> = { help: "✋", ammo: "▤", medic: "✚", attack: "⚔", defend: "⛨", ack: "✔", retreat: "↩", thanks: "♥" };

/** Phím giữ để mở vòng khẩu lệnh (V là đâm dao, C là ngồi / trượt nên dùng phím ` (~) dưới Esc). */
export const RADIO_KEY = "Backquote";
export const RADIO_KEY_LABEL = "~";

export interface RadioEntry {
  key: number;
  at: number;
  name: string;
  text: string;
  mine: boolean;
}

let feed: RadioEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function radioText(m: RadioBroadcast): string {
  const base = RADIO_TEXT[m.line];
  return m.flag ? `${base} ${m.flag}` : base;
}

export function pushRadio(m: RadioBroadcast, me: string) {
  feed = [...feed.slice(-4), { key: ++seq, at: performance.now(), name: m.name, text: radioText(m), mine: m.from === me }];
  emit();
}

/** Bỏ các dòng cũ hơn `ms`. */
export function pruneRadio(now: number, ms: number) {
  if (!feed.length || now - feed[0]!.at < ms) return;
  feed = feed.filter((e) => now - e.at < ms);
  emit();
}

export function useRadioFeed(): RadioEntry[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => feed,
  );
}

// ---------------------------------------------------------------------------- dò thứ mình đang chỉ

/**
 * Dò dọc tia (o + d·t, d đã chuẩn hoá) xem trúng địch nào trước `maxT`: người (thân hình trụ quanh tâm), hay xe tăng
 * có người lái (trả về id người lái). Trả về id hay "".
 */
export function enemyAlong(room: IslandRoom, me: string, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): string {
  const myTeam = room.state.players.get(me)?.team ?? "";
  let best = "";
  let bestT = maxT;
  const test = (cx: number, cy: number, cz: number, r: number) => {
    const t = (cx - ox) * dx + (cy - oy) * dy + (cz - oz) * dz;
    if (t <= 0 || t >= bestT) return -1;
    const px = ox + dx * t - cx;
    const py = oy + dy * t - cy;
    const pz = oz + dz * t - cz;
    // Xa thì nới vòng một chút (người ở xa chỉ còn vài điểm ảnh).
    return px * px + py * py + pz * pz < (r + t * 0.006) ** 2 ? t : -1;
  };
  for (const [id, b] of bodies) {
    if (id === me || !b.alive || (myTeam && b.team === myTeam)) continue;
    const t = test(b.x, b.y + (b.prone ? 0.35 : b.crouch ? 0.8 : 1.0), b.z, b.prone ? 0.7 : 0.75);
    if (t > 0) {
      best = id;
      bestT = t;
    }
  }
  for (const v of room.state.vehicles.values()) {
    if (v.hp <= 0 || !v.driver || v.driver === me) continue;
    const d = room.state.players.get(v.driver);
    if (!d || (myTeam && d.team === myTeam)) continue;
    const t = test(v.x, v.y + 1.3, v.z, 3);
    if (t > 0) {
      best = v.driver;
      bestT = t;
    }
  }
  return best;
}

/**
 * Đồ dưới đất nằm dọc tia nhìn (trong `maxT` mét, không xa quá 60 m): khoá trong groundItems của món gần nhất, hay "".
 */
export function lootAlong(room: IslandRoom, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): string {
  let best = "";
  let bestT = Math.min(maxT, 60);
  for (const [key, g] of room.state.groundItems) {
    const cx = g.x - ox;
    const cy = g.y + 0.15 - oy;
    const cz = g.z - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t <= 0 || t >= bestT) continue;
    const px = dx * t - cx;
    const py = dy * t - cy;
    const pz = dz * t - cz;
    const r = 0.7 + t * 0.012;
    if (px * px + py * py + pz * pz < r * r) {
      best = key;
      bestT = t;
    }
  }
  return best;
}

/** Xe tăng trống (không người lái, của đội `team` hay chưa của ai) nằm dọc tia nhìn, trong `maxT` mét. */
export function emptyTankAlong(room: IslandRoom, team: string, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): string {
  let best = "";
  let bestT = maxT;
  for (const [vid, v] of room.state.vehicles) {
    if (v.hp <= 0 || v.driver || (v.team && v.team !== team)) continue;
    const cx = v.x - ox;
    const cy = v.y + 1.2 - oy;
    const cz = v.z - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t <= 0 || t >= bestT) continue;
    const px = dx * t - cx;
    const py = dy * t - cy;
    const pz = dz * t - cz;
    if (px * px + py * py + pz * pz < 3.6 * 3.6) {
      best = vid;
      bestT = t;
    }
  }
  return best;
}
