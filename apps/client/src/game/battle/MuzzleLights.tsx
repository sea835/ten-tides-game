import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PointLight } from "three";
import { useQuality } from "../graphics.ts";
import { effects } from "./runtime.ts";

// Chớp lửa đầu nòng soi sáng xung quanh: mỗi phát bắn (của mình lẫn người khác) loé sáng tức thời lên mặt người
// lính, tường, nền đất gần đó. Dùng một nhóm nhỏ đèn điểm cố định (số đèn theo mức đồ hoạ), mỗi khung hình gán cho
// các phát bắn mới nhất gần camera nhất; đèn thừa chỉ tắt độ sáng chứ không gỡ đi — số nguồn sáng trong cảnh
// không đổi nên vật liệu không phải dựng lại shader giữa trận.

/** Số đèn theo mức đồ hoạ (đổi mức đồ hoạ thì dựng lại, như bóng đổ). */
const COUNT = { high: 3, medium: 2, low: 1 } as const;
/** Chớp đầu nòng sống chừng này giây (Tracers xoá sau 0,06 s). */
const LIFE = 0.06;
/** Xa hơn thế thì ánh chớp không đáng kể với camera. */
const RANGE = 70;

/** Chỉ số các phát bắn đã chọn (dùng lại mảng, không cấp phát mỗi khung hình). */
const picked: number[] = [];
const pickedD: number[] = [];

export function MuzzleLights() {
  const quality = useQuality();
  const count = COUNT[quality];
  const lights = useRef<(PointLight | null)[]>([]);

  useFrame(({ camera }) => {
    const now = performance.now() / 1000;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    picked.length = 0;
    pickedD.length = 0;
    // Chọn `count` phát gần camera nhất (chèn có thứ tự vào danh sách ngắn).
    for (let i = 0; i < effects.flashes.length; i++) {
      const f = effects.flashes[i]!;
      const age = now - f.born;
      if (age < 0 || age > LIFE) continue;
      const d = Math.hypot(f.x - cx, f.y - cy, f.z - cz);
      if (d > RANGE) continue;
      let k = picked.length;
      while (k > 0 && pickedD[k - 1]! > d) k--;
      if (k >= count) continue;
      // Dời phần sau lên một ô (bỏ phần tràn quá `count`), ghi vào chỗ trống.
      const n = Math.min(picked.length + 1, count);
      for (let m = n - 1; m > k; m--) {
        picked[m] = picked[m - 1]!;
        pickedD[m] = pickedD[m - 1]!;
      }
      picked[k] = i;
      pickedD[k] = d;
      picked.length = n;
      pickedD.length = n;
    }
    for (let j = 0; j < count; j++) {
      const l = lights.current[j];
      if (!l) continue;
      const idx = picked[j];
      if (idx === undefined) {
        l.intensity = 0;
        continue;
      }
      const f = effects.flashes[idx]!;
      const fade = 1 - (now - f.born) / LIFE;
      l.position.set(f.x, f.y, f.z);
      // Lửa đầu nòng nhấp nháy: mỗi phát sáng một khác.
      l.intensity = (22 + ((idx * 7919) % 13)) * (0.45 + 0.55 * fade);
    }
  });

  return (
    <>
      {Array.from({ length: count }, (_, j) => (
        <pointLight
          key={`${quality}:${j}`}
          ref={(l) => {
            lights.current[j] = l;
          }}
          color="#ffb45e"
          distance={11}
          decay={2}
          intensity={0}
        />
      ))}
    </>
  );
}
