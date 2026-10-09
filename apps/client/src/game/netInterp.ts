// Nội suy vị trí người khác và xe cộ từ các gói trạng thái server (20 gói/giây).
//
// Trước đây mỗi khung hình chỉ kéo dần hình vẽ về vị trí mới nhất (lọc mũ): gói đến sớm, đến muộn (mạng rung) là hình
// giật theo, đi thẳng mà trông như khựng từng nhịp. Giờ mỗi gói được ghi vào một băng nhỏ kèm thời điểm của gói theo
// một đồng hồ đã làm mượt (gói đến lệch nhịp vài chục ms thì vẫn coi như đến đúng nhịp), rồi vẽ lùi lại INTERP_DELAY
// so với hiện tại bằng đường cong Hermite bậc ba, độ dốc hai đầu là vận tốc ước lượng từ các gói bên cạnh: đi qua
// đúng từng điểm server gửi, vận tốc liền mạch, không gãy góc. Băng cạn (gói trễ quá) thì đi tiếp theo vận tốc cuối
// một chút rồi đứng lại. Killcam vẫn dùng băng riêng (battle/replay.ts), không đụng tới đây.

import type { IslandRoom } from "../net.ts";

/** Vẽ lùi lại chừng này giây: hai nhịp gói, đủ để luôn có điểm phía trước dù một gói đến muộn. */
export const INTERP_DELAY = 0.1;
/** Băng cạn thì đi tiếp theo vận tốc cuối tối đa chừng này giây rồi đứng lại. */
const EXTRAPOLATE = 0.12;
/** Một nhịp mà nhảy xa hơn chừng này (m) là dịch chuyển tức thời (hồi sinh, lên xe): bỏ băng, đặt thẳng tới chỗ mới. */
const TELEPORT = 12;
const CAP = 8;

/** Đồng hồ nhịp gói: thời điểm (giây) của từng gói, làm mượt quanh nhịp đều của server. */
export class PatchClock {
  /** Thời điểm đã làm mượt của gói gần nhất. */
  time = -Infinity;
  /** Khoảng cách giữa hai gói (ước lượng, giây). */
  interval = 0.05;
  private raw = -Infinity;
  count = 0;

  /** Một gói vừa đến lúc `now` (giây); trả về thời điểm đã làm mượt của nó. */
  tick(now: number): number {
    const gap = now - this.raw;
    this.raw = now;
    this.count++;
    if (!Number.isFinite(this.time) || gap > 0.5) {
      // Gói đầu, hay sau một quãng im lặng (tab ẩn, mất mạng): lấy luôn giờ đến.
      this.time = now;
      return now;
    }
    // Hai gói dồn trong một khung hình (gap ~0) không làm lệch ước lượng nhịp.
    if (gap > 0.005) this.interval += (Math.min(0.25, gap) - this.interval) * 0.05;
    const predicted = this.time + this.interval;
    // Kéo nhẹ về giờ đến thật (bám theo đồng hồ, khử rung); lệch quá xa thì bám luôn.
    const err = now - predicted;
    this.time = Math.abs(err) > 0.25 ? now : predicted + err * 0.1;
    return this.time;
  }
}

/** Băng vị trí của một vật: vài gói gần nhất, nội suy Hermite theo thời gian. */
export class Track {
  private t = new Float64Array(CAP);
  private v = new Float64Array(CAP * 4);
  private n = 0;
  private head = 0;

  get size(): number {
    return this.n;
  }

  clear() {
    this.n = 0;
  }

  /** Ghi một gói: thời điểm `t`, vị trí và hướng (`yaw` đã gỡ vòng ở `push`, nên nội suy được như số thường). */
  push(t: number, x: number, y: number, z: number, yaw: number) {
    if (this.n > 0) {
      const last = this.head;
      const lt = this.t[last]!;
      const lv = last * 4;
      const jump = Math.hypot(x - this.v[lv]!, z - this.v[lv + 2]!);
      if (jump > TELEPORT) this.n = 0;
      else {
        // Gỡ vòng hướng quay: cộng hiệu đã gói vòng vào hướng trước, để 359° → 1° là +2° chứ không phải −358°.
        const prev = this.v[lv + 3]!;
        yaw = prev + Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev));
        if (t <= lt) {
          // Cùng một nhịp (hai gói dồn): ghi đè.
          this.set(last, lt, x, y, z, yaw);
          return;
        }
      }
    }
    this.head = this.n === 0 ? 0 : (this.head + 1) % CAP;
    this.n = Math.min(CAP, this.n + 1);
    this.set(this.head, t, x, y, z, yaw);
  }

  private set(i: number, t: number, x: number, y: number, z: number, yaw: number) {
    this.t[i] = t;
    const o = i * 4;
    this.v[o] = x;
    this.v[o + 1] = y;
    this.v[o + 2] = z;
    this.v[o + 3] = yaw;
  }

  /** Chỉ số gói thứ `k` tính từ cũ nhất (0) tới mới nhất (n−1). */
  private at(k: number): number {
    return (this.head - (this.n - 1 - k) + CAP * 2) % CAP;
  }

  /** Vận tốc (đơn vị/giây) ở gói thứ `k`: hiệu hai gói hai bên (Catmull-Rom theo thời gian thật), ở mép thì một phía. */
  private slope(k: number, c: number): number {
    const a = this.at(Math.max(0, k - 1));
    const b = this.at(Math.min(this.n - 1, k + 1));
    const dt = this.t[b]! - this.t[a]!;
    return dt > 1e-6 ? (this.v[b * 4 + c]! - this.v[a * 4 + c]!) / dt : 0;
  }

  /**
   * Vị trí lúc `rt` (giây) ghi vào `out` (x, y, z, yaw — yaw chưa gói lại vòng). Trả về false nếu băng trống.
   */
  sample(rt: number, out: { x: number; y: number; z: number; rotY: number }): boolean {
    const n = this.n;
    if (n === 0) return false;
    const newest = this.at(n - 1);
    if (n === 1 || rt >= this.t[newest]!) {
      // Băng cạn: đi tiếp theo vận tốc cuối một lúc ngắn rồi đứng.
      const over = n === 1 ? 0 : Math.min(EXTRAPOLATE, rt - this.t[newest]!);
      const o = newest * 4;
      out.x = this.v[o]! + (n > 1 ? this.slope(n - 1, 0) * over : 0);
      out.y = this.v[o + 1]! + (n > 1 ? this.slope(n - 1, 1) * over : 0);
      out.z = this.v[o + 2]! + (n > 1 ? this.slope(n - 1, 2) * over : 0);
      out.rotY = this.v[o + 3]!;
      return true;
    }
    const oldest = this.at(0);
    if (rt <= this.t[oldest]!) {
      const o = oldest * 4;
      out.x = this.v[o]!;
      out.y = this.v[o + 1]!;
      out.z = this.v[o + 2]!;
      out.rotY = this.v[o + 3]!;
      return true;
    }
    // Tìm đoạn [k, k+1] chứa rt (băng ngắn, duyệt từ mới về cũ).
    let k = n - 2;
    while (k > 0 && this.t[this.at(k)]! > rt) k--;
    const i0 = this.at(k);
    const i1 = this.at(k + 1);
    const t0 = this.t[i0]!;
    const h = this.t[i1]! - t0;
    const u = h > 1e-6 ? (rt - t0) / h : 1;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const o0 = i0 * 4;
    const o1 = i1 * 4;
    out.x = h00 * this.v[o0]! + h10 * h * this.slope(k, 0) + h01 * this.v[o1]! + h11 * h * this.slope(k + 1, 0);
    out.y = h00 * this.v[o0 + 1]! + h10 * h * this.slope(k, 1) + h01 * this.v[o1 + 1]! + h11 * h * this.slope(k + 1, 1);
    out.z = h00 * this.v[o0 + 2]! + h10 * h * this.slope(k, 2) + h01 * this.v[o1 + 2]! + h11 * h * this.slope(k + 1, 2);
    // Hướng quay nội suy tuyến tính (đường cong cho hướng dễ vọt quá khi quay gắt).
    out.rotY = this.v[o0 + 3]! + (this.v[o1 + 3]! - this.v[o0 + 3]!) * u;
    return true;
  }
}

/** Băng của mọi người và mọi xe trong phòng đang chơi; ghi ngay khi mỗi gói trạng thái vừa giải mã xong. */
const clock = new PatchClock();
export const playerTracks = new Map<string, Track>();
export const vehicleTracks = new Map<string, Track>();
let bound: IslandRoom | null = null;
let unbind: (() => void) | null = null;
/** Số component đang cần băng (người, xe tăng, xe chở): người cuối cùng thôi thì mới thôi ghi. */
let users = 0;

function record(tracks: Map<string, Track>, id: string, t: number, e: { x: number; y: number; z: number; rotY: number }) {
  let tr = tracks.get(id);
  if (!tr) {
    tr = new Track();
    tracks.set(id, tr);
  }
  tr.push(t, e.x, e.y, e.z, e.rotY);
}

/** Bắt đầu ghi băng cho phòng `room` (nhiều component cùng gọi được, đếm số người dùng); trả về hàm thôi dùng. */
export function trackRoom(room: IslandRoom): () => void {
  if (bound !== room) {
    unbind?.();
    users = 0;
    bind(room);
  }
  users++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (bound === room && --users <= 0) unbind?.();
  };
}

function bind(room: IslandRoom) {
  bound = room;
  playerTracks.clear();
  vehicleTracks.clear();
  const onPatch = () => {
    const t = clock.tick(performance.now() / 1000);
    const s = room.state;
    s.players?.forEach((p, id) => record(playerTracks, id, t, p));
    s.vehicles?.forEach((v, id) => record(vehicleTracks, id, t, v));
    // Dọn băng của người, xe đã rời phòng.
    if (clock.count % 200 === 0) {
      for (const id of playerTracks.keys()) if (!s.players?.has(id)) playerTracks.delete(id);
      for (const id of vehicleTracks.keys()) if (!s.vehicles?.has(id)) vehicleTracks.delete(id);
    }
  };
  room.onStateChange(onPatch);
  unbind = () => {
    room.onStateChange.remove(onPatch);
    bound = null;
    unbind = null;
    users = 0;
    playerTracks.clear();
    vehicleTracks.clear();
  };
}

/** Thời điểm đang vẽ (giây, cùng đồng hồ với băng): hiện tại lùi INTERP_DELAY. */
export function renderTime(): number {
  return performance.now() / 1000 - INTERP_DELAY;
}

/** Tư thế nội suy của người / xe `id` ghi vào `out`; false nếu chưa có băng (dùng trạng thái thô). */
export function sampleTrack(tracks: Map<string, Track>, id: string, out: { x: number; y: number; z: number; rotY: number }): boolean {
  return tracks.get(id)?.sample(renderTime(), out) ?? false;
}
