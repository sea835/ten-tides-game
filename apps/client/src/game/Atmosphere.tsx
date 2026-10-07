import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { IslandRoom } from "../net.ts";
import { CLOUD_TILE, cloudUniforms, wetUniforms } from "./atmosphere.ts";
import { bodies, effects, seat } from "./battle/runtime.ts";
import { windStrength } from "./nature.ts";
import { localEnv, localMotion, localPosition, sky, weatherFx } from "./shared.ts";
import { TRAMPLE_BLASTS, TRAMPLERS, trampleUniforms } from "./trample.ts";

// Mỗi khung hình ghi các uniform dùng chung của khí quyển: bóng mây trôi theo gió, độ ướt của súng trước mặt, và
// danh sách vật giẫm cỏ (mình, người gần nhất, xe) cùng các vụ nổ gần đây. Không cấp phát gì trong vòng lặp.

/** Hướng mây trôi: cùng hướng với mây vẽ trên vòm trời (Sky.tsx trôi toạ độ theo (1; 0,35)). */
const DRIFT_X = 1 / Math.hypot(1, 0.35);
const DRIFT_Z = 0.35 / Math.hypot(1, 0.35);

/** Vết chân của mình: vài điểm cũ mờ dần để cỏ đứng dậy từ từ. */
const TRAIL = 2;
const TRAIL_EVERY = 0.28;
const TRAIL_LIFE = 1.5;
/** Chỉ xét người, xe trong tầm này (ngoài xa thảm cỏ đã thưa, không thấy). */
const NEAR = 45;
/** Nổ trong chừng này giây thì còn sóng xung kích trên cỏ. */
const BLAST_LIFE = 1.6;

const candX = new Float32Array(TRAMPLERS);
const candZ = new Float32Array(TRAMPLERS);
const candR = new Float32Array(TRAMPLERS);
const candD = new Float32Array(TRAMPLERS);
let candN = 0;
/** Số chỗ giữ sẵn cho mình và vết chân. */
let reserved = 0;
let camX = 0;
let camZ = 0;

/** Giữ các ứng viên gần camera nhất (chèn có thứ tự, không cấp phát). */
function offer(x: number, z: number, r: number) {
  const d = (x - camX) * (x - camX) + (z - camZ) * (z - camZ);
  const cap = TRAMPLERS - reserved;
  if (d > NEAR * NEAR || cap <= 0) return;
  let i: number;
  if (candN < cap) i = candN++;
  else if (d >= candD[cap - 1]!) return;
  else i = cap - 1;
  while (i > 0 && candD[i - 1]! > d) {
    candX[i] = candX[i - 1]!;
    candZ[i] = candZ[i - 1]!;
    candR[i] = candR[i - 1]!;
    candD[i] = candD[i - 1]!;
    i--;
  }
  candX[i] = x;
  candZ[i] = z;
  candR[i] = r;
  candD[i] = d;
}

const VEHICLE_RADIUS: Record<string, number> = { tank: 3.4, jeep: 2.3 };

function offerBody(b: { x: number; z: number; alive: boolean; prone: boolean }) {
  if (b.alive) offer(b.x, b.z, b.prone ? 1.5 : 1.15);
}

function offerVehicle(v: { kind: string; x: number; z: number; hp: number }) {
  const r = VEHICLE_RADIUS[v.kind];
  if (r && v.hp > 0) offer(v.x, v.z, r);
}

export function Atmosphere({ room }: { room: IslandRoom }) {
  const trail = useRef({ x: new Float32Array(TRAIL), z: new Float32Array(TRAIL), at: new Float32Array(TRAIL).fill(-99), next: 0, lastX: 0, lastZ: 0 });
  const soaked = useRef(0);

  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const now = clock.elapsedTime;
    const w = weatherFx;

    // ---- bóng mây: trôi theo gió (bão thì nhanh), phủ nhiều theo độ mây, tắt về đêm.
    const speed = (2.2 + 2.6 * (windStrength.value - 1)) * dt / CLOUD_TILE;
    const off = cloudUniforms.uCloudOffset.value;
    off.x = (off.x + DRIFT_X * speed) % 100;
    off.y = (off.y + DRIFT_Z * speed) % 100;
    cloudUniforms.uCloudCover.value = 0.62 - 0.26 * w.cloud;
    const day = Math.min(1, sky.elevation * 6) * (1 - sky.night);
    cloudUniforms.uCloudShadow.value = w.cloud < 0.06 ? 0 : day * (0.42 + 0.3 * w.cloud) * (1 - 0.35 * Math.max(0, w.cloud - 0.8) / 0.2);

    // ---- súng, găng ướt: dầm mưa ngoài trời thấm dần, vừa bơi/lặn thì ướt sũng rồi khô trong ~30 giây.
    if (localMotion.swimming || localEnv.underwater) soaked.current = 1;
    else soaked.current = Math.max(0, soaked.current - dt / 30);
    const rain = w.rain * (1 - localEnv.indoor);
    const wet = wetUniforms.uViewWet;
    const goal = Math.max(Math.min(1, rain * 1.4), soaked.current);
    wet.value += (goal - wet.value) * Math.min(1, dt * (goal > wet.value ? 0.6 : 0.08));
    if (soaked.current > wet.value) wet.value = soaked.current;

    // ---- vật giẫm cỏ.
    camX = camera.position.x;
    camZ = camera.position.z;
    candN = 0;
    const t = trail.current;
    const onFoot = !seat.id && !localMotion.swimming;
    // Mình luôn có một chỗ (và hai điểm vết chân), còn lại cho người, xe gần nhất.
    reserved = onFoot ? 1 + TRAIL : 0;
    if (onFoot && now >= t.next) {
      const moved = Math.hypot(localPosition.x - t.lastX, localPosition.z - t.lastZ);
      if (moved > 0.35) {
        t.next = now + TRAIL_EVERY;
        for (let i = TRAIL - 1; i > 0; i--) {
          t.x[i] = t.x[i - 1]!;
          t.z[i] = t.z[i - 1]!;
          t.at[i] = t.at[i - 1]!;
        }
        t.x[0] = t.lastX;
        t.z[0] = t.lastZ;
        t.at[0] = now;
        t.lastX = localPosition.x;
        t.lastZ = localPosition.z;
      }
    }
    // Duyệt bằng forEach với hàm tạo sẵn: khỏi cấp phát iterator, closure mỗi khung hình.
    bodies.forEach(offerBody);
    const vehicles = (room.state as { vehicles?: { forEach: (cb: typeof offerVehicle) => void } }).vehicles;
    vehicles?.forEach(offerVehicle);
    const slots = trampleUniforms.uTramplers.value;
    let k = 0;
    if (onFoot) {
      slots[k++]!.set(localPosition.x, localPosition.z, localMotion.prone ? 1.5 : 1.2, 1);
      for (let i = 0; i < TRAIL; i++) {
        const age = now - t.at[i]!;
        const s = age < TRAIL_LIFE ? 0.85 * (1 - age / TRAIL_LIFE) : 0;
        slots[k++]!.set(t.x[i]!, t.z[i]!, s > 0 ? 1.1 : 0, s);
      }
    }
    for (let i = 0; i < candN && k < TRAMPLERS; i++) slots[k++]!.set(candX[i]!, candZ[i]!, candR[i]!, 1);
    while (k < TRAMPLERS) slots[k++]!.set(0, 0, 0, 0);

    // ---- sóng xung kích của các vụ nổ gần đây (Effects.tsx đẩy vào effects.blasts, giờ tính bằng giây).
    const blasts = trampleUniforms.uTrampleBlasts.value;
    const sec = performance.now() / 1000;
    let n = 0;
    for (let i = effects.blasts.length - 1; i >= 0 && n < TRAMPLE_BLASTS; i--) {
      const b = effects.blasts[i]!;
      const age = sec - b.born;
      if (age < 0 || age > BLAST_LIFE || b.kind === "smoke") continue;
      blasts[n++]!.set(b.x, b.z, age, b.big || b.kind === "mine" ? 9 : b.kind === "flash" ? 4 : 7.5);
    }
    while (n < TRAMPLE_BLASTS) blasts[n++]!.set(0, 0, 0, 0);
  });
  return null;
}
