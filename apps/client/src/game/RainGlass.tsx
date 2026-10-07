import { useEffect, useRef } from "react";
import { stance } from "./battle/runtime.ts";
import { localEnv, weatherFx } from "./shared.ts";

// Giọt mưa đọng trên "mặt kính" màn hình khi dầm mưa ngoài trời: giọt bám lại một lúc rồi trượt xuống để lại vệt nước
// mờ. Vẽ bằng canvas 2D nửa độ phân giải, ~30 khung hình mỗi giây, chỉ chạy khi có mưa (tạnh thì vẽ nốt giọt còn
// lại rồi nghỉ). Không đọc ảnh cảnh 3D nên gần như không tốn gì; giọt sáng mép, tối lõi giả khúc xạ.

const MAX_DROPS = 48;
const STEP_MS = 33;

interface Drop {
  x: number;
  y: number;
  r: number;
  /** Đang trượt xuống (px/giây), 0 là còn bám. */
  vy: number;
  /** Bám thêm chừng này giây nữa thì trượt. */
  hold: number;
  /** Đuôi vệt nước phía trên giọt đang trượt (y bắt đầu). */
  tail: number;
  life: number;
  alive: boolean;
}

export function RainGlass() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({ x: 0, y: 0, r: 0, vy: 0, hold: 0, tail: 0, life: 0, alive: false }));
    let raf = 0;
    let last = performance.now();
    let spawn = 0;
    let idle = true;
    const resize = () => {
      const w = Math.max(1, Math.round(c.clientWidth / 2));
      const h = Math.max(1, Math.round(c.clientHeight / 2));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < STEP_MS) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Trong nhà, dưới nước, nhìn qua ống ngắm thì không có giọt mới.
      const amount = weatherFx.rain * (1 - localEnv.indoor) * (localEnv.underwater ? 0 : 1) * (stance.scoped ? 0 : 1);
      let any = false;
      for (const d of drops) if (d.alive) any = true;
      if (amount < 0.02 && !any) {
        if (!idle) {
          ctx.clearRect(0, 0, c.width, c.height);
          c.style.display = "none";
          idle = true;
        }
        return;
      }
      if (idle) {
        c.style.display = "block";
        idle = false;
      }
      resize();
      const W = c.width;
      const H = c.height;
      spawn += dt * amount * 14;
      while (spawn >= 1) {
        spawn -= 1;
        const d = drops.find((x) => !x.alive);
        if (!d) break;
        d.alive = true;
        d.x = Math.random() * W;
        d.y = Math.random() * H * 0.9;
        d.r = (2.2 + Math.random() * Math.random() * 6) * (H / 360);
        d.vy = 0;
        d.hold = 0.4 + Math.random() * 2.5;
        d.tail = d.y;
        d.life = 0;
      }
      ctx.clearRect(0, 0, W, H);
      for (const d of drops) {
        if (!d.alive) continue;
        d.life += dt;
        if (d.vy === 0) {
          d.hold -= dt;
          // Giọt to thì nặng, trượt sớm hơn.
          if (d.hold <= 0) d.vy = (40 + d.r * 18 + Math.random() * 30) * (H / 360);
        } else {
          d.y += d.vy * dt;
          d.x += Math.sin(d.y * 0.05 + d.r) * 0.3;
          // Đuôi vệt nước co dần lại phía sau giọt.
          d.tail += (d.y - d.tail) * Math.min(1, dt * 1.6);
          d.r *= 1 - dt * 0.18;
        }
        // Giọt bám lâu thì khô dần; trượt khỏi màn hình hay quá nhỏ thì bỏ.
        const fade = Math.min(1, d.life * 4) * (d.vy === 0 ? Math.min(1, (d.hold + 0.6) / 0.6) : 1);
        if (d.y - d.r > H || d.r < 0.6 || fade <= 0) {
          d.alive = false;
          continue;
        }
        const a = 0.55 * fade;
        if (d.vy > 0 && d.y - d.tail > 2) {
          ctx.strokeStyle = `rgba(210,225,235,${(a * 0.35).toFixed(3)})`;
          ctx.lineWidth = d.r * 0.7;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(d.x, d.tail);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
        }
        // Thân giọt: lõi tối nhẹ (khúc xạ cảnh đảo ngược), viền dưới sáng, chấm sáng phía trên như nắng loé.
        ctx.fillStyle = `rgba(40,55,65,${(a * 0.35).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r * 0.9, d.r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(230,240,248,${(a * 0.7).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.6, d.r * 0.25);
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r * 0.9, d.r, 0, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.4, Math.max(0.5, d.r * 0.22), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvas} className="rain-glass" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", display: "none" }} />;
}
