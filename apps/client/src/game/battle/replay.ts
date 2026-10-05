import { useSyncExternalStore } from "react";
import type { ShotMessage } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";

// Băng ghi hình cho killcam: ghi lại vài giây gần nhất của mọi người trong trận (vị trí, hướng mặt, góc ngắm, tư thế,
// bộ đếm phát bắn) 20 lần mỗi giây vào bộ đệm vòng cấp sẵn (không tạo đối tượng mỗi khung hình), cùng các phát bắn
// (Messages.shot) để vẽ lại vệt đạn. Khi phát lại, RemotePlayers hỏi `replayPose(id)` để đặt người khác đúng chỗ của
// thời điểm đang phát thay vì vị trí hiện tại.

/** Ghi 20 lần mỗi giây, giữ 16 giây (đủ 5 giây trước khi gục cộng thời gian phát lại). */
const RATE = 1 / 20;
const N = 320;
/** Số ô mỗi khung: x, y, z, rotY, aimPitch, lean, cờ tư thế, bộ đếm phát bắn. */
const F = 8;
const CROUCH = 1;
const PRONE = 2;
const AIM = 4;
const MOVE = 8;
const ALIVE = 16;

interface Track {
  data: Float32Array;
  /** Số khung đã ghi vào từng ô (ô cũ của người khác, hay người mới vào, thì không khớp). */
  frame: Int32Array;
  /** Súng, áo đang dùng lần cuối còn sống (để vẽ lại người gục với đúng súng, áo). */
  weapon: string;
  outfit: string;
  color: string;
  last: number;
}

const times = new Float64Array(N);
let frameNo = 0;
let lastRec = -1;
const tracks = new Map<string, Track>();

/** Tư thế phát lại (một đối tượng dùng chung: đọc xong ngay, không giữ lại). Tên trường như PlayerState. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  rotY: number;
  aimPitch: number;
  lean: number;
  crouching: boolean;
  prone: boolean;
  aiming: boolean;
  moving: boolean;
  shots: number;
  alive: boolean;
}
const pose: Pose = { x: 0, y: 0, z: 0, rotY: 0, aimPitch: 0, lean: 0, crouching: false, prone: false, aiming: false, moving: false, shots: 0, alive: false };

/**
 * Đang phát lại: hai khung kẹp thời điểm đang phát (`fa`, `fb`) và tỉ lệ nội suy. `snap`: khung hình đầu (hay ngay
 * sau khi hết) phát lại, người khác nhảy thẳng tới chỗ mới thay vì trôi dần tới.
 */
export const replay = { active: false, fa: 0, fb: 0, k: 0, snap: false };

/** Ghi một khung (gọi mỗi khung hình; tự giãn ra 20 lần mỗi giây). `now` tính bằng giây. */
export function record(room: IslandRoom, now: number) {
  if (now - lastRec < RATE) return;
  lastRec = now;
  const f = ++frameNo;
  const slot = f % N;
  times[slot] = now;
  const o = slot * F;
  room.state.players.forEach((p, id) => {
    let tr = tracks.get(id);
    if (!tr) {
      tr = { data: new Float32Array(N * F), frame: new Int32Array(N), weapon: "", outfit: "", color: "", last: 0 };
      tracks.set(id, tr);
    }
    const d = tr.data;
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.z;
    d[o + 3] = p.rotY;
    d[o + 4] = p.aimPitch;
    d[o + 5] = p.lean;
    d[o + 6] = (p.crouching ? CROUCH : 0) | (p.prone ? PRONE : 0) | (p.aiming ? AIM : 0) | (p.moving ? MOVE : 0) | (p.alive && !p.vehicle ? ALIVE : 0);
    d[o + 7] = p.shots;
    tr.frame[slot] = f;
    tr.last = f;
    if (p.alive) {
      const k = p.kit;
      const slot = k.active;
      const w = slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "";
      if (w) tr.weapon = w;
      tr.outfit = k.outfit;
      tr.color = p.color;
    }
  });
  // Dọn băng của người đã rời phòng (lâu rồi không ghi).
  if (f % 100 === 0) for (const [id, tr] of tracks) if (f - tr.last > N) tracks.delete(id);
}

/** Có băng ghi của người này không (đủ để phát lại). */
export function hasTrack(id: string): boolean {
  const tr = tracks.get(id);
  return !!tr && frameNo - tr.last < 10;
}

/** Súng, áo, màu ghi lần cuối người này còn sống. */
export function trackLook(id: string): { weapon: string; outfit: string; color: string } {
  const tr = tracks.get(id);
  return { weapon: tr?.weapon ?? "", outfit: tr?.outfit ?? "", color: tr?.color ?? "#ffffff" };
}

/** Khung cũ nhất còn trong băng. */
function oldestFrame(): number {
  return Math.max(1, frameNo - N + 1);
}

/** Thời điểm cũ nhất còn trong băng (giây). */
export function oldestTime(): number {
  return times[oldestFrame() % N]!;
}

/** Chọn hai khung kẹp thời điểm `t` (giây) để phát lại. */
export function seek(t: number) {
  const stop = oldestFrame();
  let fa = frameNo;
  while (fa > stop && times[fa % N]! > t) fa--;
  const fb = Math.min(frameNo, fa + 1);
  const ta = times[fa % N]!;
  const tb = times[fb % N]!;
  replay.fa = fa;
  replay.fb = fb;
  replay.k = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 1;
}

function lerpAngle(a: number, b: number, k: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
}

/** Tư thế người `id` ở thời điểm đang phát lại; null nếu không phát lại hay không có băng của người đó. */
export function replayPose(id: string): Pose | null {
  if (!replay.active) return null;
  const tr = tracks.get(id);
  if (!tr) return null;
  const sa = replay.fa % N;
  const sb = replay.fb % N;
  const okA = tr.frame[sa] === replay.fa;
  const okB = tr.frame[sb] === replay.fb;
  if (!okA && !okB) return null;
  const a = (okA ? sa : sb) * F;
  const b = (okB ? sb : sa) * F;
  const k = replay.k;
  const d = tr.data;
  pose.x = d[a]! + (d[b]! - d[a]!) * k;
  pose.y = d[a + 1]! + (d[b + 1]! - d[a + 1]!) * k;
  pose.z = d[a + 2]! + (d[b + 2]! - d[a + 2]!) * k;
  pose.rotY = lerpAngle(d[a + 3]!, d[b + 3]!, k);
  pose.aimPitch = d[a + 4]! + (d[b + 4]! - d[a + 4]!) * k;
  pose.lean = d[a + 5]! + (d[b + 5]! - d[a + 5]!) * k;
  const flags = k < 0.5 ? d[a + 6]! : d[b + 6]!;
  pose.crouching = (flags & CROUCH) !== 0;
  pose.prone = (flags & PRONE) !== 0;
  pose.aiming = (flags & AIM) !== 0;
  pose.moving = (flags & MOVE) !== 0;
  pose.alive = (flags & ALIVE) !== 0;
  pose.shots = k < 0.5 ? d[a + 7]! : d[b + 7]!;
  return pose;
}

// ---------------------------------------------------------------------------- phát bắn

export interface ShotRec {
  t: number;
  id: string;
  w: string;
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  quiet: boolean;
}
const SHOTS = 256;
const shots: ShotRec[] = Array.from({ length: SHOTS }, () => ({ t: -1, id: "", w: "", ox: 0, oy: 0, oz: 0, ex: 0, ey: 0, ez: 0, quiet: false }));
let shotHead = 0;

/** Ghi một phát bắn (Messages.shot) lúc `now` (giây). */
export function recordShot(m: ShotMessage, now: number) {
  const s = shots[shotHead]!;
  shotHead = (shotHead + 1) % SHOTS;
  const e = m.e[0] ?? m.o;
  s.t = now;
  s.id = m.id;
  s.w = m.w;
  s.ox = m.o[0];
  s.oy = m.o[1];
  s.oz = m.o[2];
  s.ex = e[0];
  s.ey = e[1];
  s.ez = e[2];
  s.quiet = !!m.s;
}

/** Gọi `fn` cho từng phát bắn có thời điểm trong (from, to]. */
export function shotsBetween(from: number, to: number, fn: (s: ShotRec) => void) {
  for (let i = 0; i < SHOTS; i++) {
    const s = shots[i]!;
    if (s.t > from && s.t <= to) fn(s);
  }
}

/** Xoá băng (vào phòng khác). */
export function clearReplay() {
  tracks.clear();
  frameNo = 0;
  lastRec = -1;
  for (const s of shots) s.t = -1;
  replay.active = false;
}

// ---------------------------------------------------------------------------- kho cho HUD

/** Killcam đang chiếu: kẻ hạ mình, súng, khoảng cách (m), vào đầu không. */
export interface KillcamInfo {
  killer: string;
  name: string;
  weapon: string;
  dist: number;
  headshot: boolean;
  /** Thời lượng (giây) để vẽ thanh tiến độ. */
  duration: number;
  startedAt: number;
}

let info: KillcamInfo | null = null;
const listeners = new Set<() => void>();

export function getKillcam(): KillcamInfo | null {
  return info;
}

export function setKillcam(next: KillcamInfo | null) {
  if (info === next) return;
  info = next;
  listeners.forEach((l) => l());
}

/** Bấm "Bỏ qua": khung cảnh (Killcam.tsx) thấy cờ này thì dừng phát lại. */
export const killcamSkip = { requested: false };

export function useKillcam(): KillcamInfo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => info,
  );
}
