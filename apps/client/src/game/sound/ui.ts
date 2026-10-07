import { audio, noiseBurst, tone, unlockAudioOnGesture } from "./engine.ts";

// Âm thanh giao diện "xúc giác" (Haptic UI): rê chuột qua nút có tiếng tích cơ khí rất nhẹ, bấm nút tiếng tách, chọn
// trang bị / lắp phụ kiện tiếng "cạch" chốt kim loại đầm tay, mở hòm Gacha có nhịp bass dồn dập rồi bùng hợp âm huyền
// ảo khi ra skin Huyền thoại. Tất cả tổng hợp tại chỗ, đi qua bus "ui" (theo âm lượng tổng và nút tắt tiếng).
// Nút muốn tiếng "cạch" thay cho tiếng tách thì gắn thuộc tính data-ui="clack".

type UiRecipe = (out: AudioNode, t: number, k: number) => void;

const RECIPES = {
  /** Rê chuột qua nút: tích cơ khí siêu nhẹ. */
  tick: (o, t) => {
    tone(o, t, { type: "triangle", freq: 4200, freqEnd: 3600, decay: 0.014, peak: 0.07 });
    noiseBurst(o, t, { type: "highpass", freq: 6500, decay: 0.008, peak: 0.05 });
  },
  /** Bấm nút thường: tiếng tách nhỏ. */
  click: (o, t) => {
    tone(o, t, { type: "triangle", freq: 1500, freqEnd: 1150, decay: 0.04, peak: 0.26 });
    noiseBurst(o, t, { type: "bandpass", freq: 3200, q: 2, decay: 0.018, peak: 0.12 });
  },
  /** Chọn trang bị, lắp phụ kiện: chốt kim loại sập vào (tiếng kim loại sắc rồi tiếng "cạch" trầm chắc). */
  clack: (o, t) => {
    noiseBurst(o, t, { type: "highpass", freq: 3000, decay: 0.025, peak: 0.35 });
    tone(o, t, { type: "triangle", freq: 2350, decay: 0.07, peak: 0.12 });
    tone(o, t, { type: "triangle", freq: 3530, decay: 0.05, peak: 0.07 });
    noiseBurst(o, t + 0.045, { type: "bandpass", freq: 950, q: 1.6, decay: 0.06, peak: 0.45 });
    tone(o, t + 0.045, { freq: 190, freqEnd: 95, decay: 0.1, peak: 0.55 });
  },
  /** Nhịp bass dồn dập lúc mở hòm (k: 0 → 1 càng về sau càng cao, càng mạnh). */
  pulse: (o, t, k) => {
    tone(o, t, { freq: 48 + k * 26, freqEnd: 38 + k * 18, decay: 0.32, peak: 0.55 + k * 0.35 });
    tone(o, t, { type: "triangle", freq: 96 + k * 52, freqEnd: 70 + k * 30, decay: 0.12, peak: 0.18 });
    noiseBurst(o, t, { type: "lowpass", freq: 260 + k * 200, decay: 0.08, peak: 0.35 });
  },
  /** Lật thẻ thường. */
  flip: (o, t) => {
    noiseBurst(o, t, { type: "bandpass", freq: 1400, freqEnd: 3200, q: 1.2, attack: 0.01, decay: 0.07, peak: 0.25 });
    tone(o, t + 0.02, { type: "sine", freq: 880, decay: 0.12, peak: 0.12 });
  },
  /** Ra Sử thi: hợp âm ba nốt sáng. */
  epic: (o, t) => {
    for (const [i, f] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      tone(o, t + i * 0.035, { type: "triangle", freq: f, attack: 0.01, decay: 1.1, peak: 0.16 });
    }
    noiseBurst(o, t, { type: "highpass", freq: 5000, attack: 0.02, decay: 0.6, peak: 0.06 });
  },
  /** Ra Huyền thoại: cú nổ trầm, hợp âm La trưởng thêm nốt 9 trải rộng, lấp lánh kéo dài. */
  legendary: (o, t) => {
    tone(o, t, { freq: 70, freqEnd: 34, decay: 0.9, peak: 0.9 });
    noiseBurst(o, t, { brown: true, type: "lowpass", freq: 700, decay: 0.6, peak: 0.5 });
    const chord = [220, 277.18, 329.63, 440, 493.88, 554.37, 659.25, 880, 1108.73, 1318.5];
    chord.forEach((f, i) => {
      tone(o, t + 0.02 + i * 0.03, { type: "triangle", freq: f, attack: 0.03, decay: 2.4, peak: 0.12 });
      tone(o, t + 0.02 + i * 0.03, { type: "sine", freq: f * 2, detune: 7, attack: 0.05, decay: 1.6, peak: 0.04 });
    });
    // Chuông lấp lánh rắc lên cao.
    for (let i = 0; i < 8; i++) tone(o, t + 0.25 + i * 0.09, { type: "sine", freq: 1760 * Math.pow(2, (i % 5) / 5), decay: 0.5, peak: 0.05 });
    noiseBurst(o, t + 0.05, { type: "highpass", freq: 6000, attack: 0.08, decay: 1.6, peak: 0.1 });
  },
  /** Số đếm nhảy (bảng tổng kết): tích kim loại nhỏ. */
  count: (o, t) => tone(o, t, { type: "square", freq: 2600, decay: 0.012, peak: 0.035 }),
  /** Huân chương mở khoá: tiếng kim loại ngân và tia lấp lánh. */
  medal: (o, t) => {
    tone(o, t, { type: "triangle", freq: 1318.5, decay: 0.9, peak: 0.16 });
    tone(o, t + 0.06, { type: "triangle", freq: 1975.5, decay: 0.7, peak: 0.1 });
    tone(o, t, { freq: 160, freqEnd: 80, decay: 0.15, peak: 0.4 });
    noiseBurst(o, t + 0.03, { type: "highpass", freq: 5500, decay: 0.4, peak: 0.08 });
  },
} satisfies Record<string, UiRecipe>;

export type UiSound = keyof typeof RECIPES;

/** Phát một tiếng giao diện, sau `delay` giây; `k` là tham số của công thức (vd. độ dồn của nhịp bass). */
export function playUi(kind: UiSound, delay = 0, k = 0, volume = 1) {
  const out = audio.output("ui", volume);
  if (!out) return;
  (RECIPES[kind] as UiRecipe)(out, audio.ctx!.currentTime + Math.max(0, delay), k);
}

/**
 * Nhịp bass dồn dập trước khi lật thẻ Gacha: `seconds` giây, các nhịp sát dần và mạnh dần. `best`: độ hiếm cao nhất
 * (0–3), hiếm càng cao càng nhiều nhịp.
 */
export function gachaBuildUp(seconds: number, best: number) {
  const n = 3 + best;
  for (let i = 0; i < n; i++) {
    const u = i / Math.max(1, n - 1);
    // Khoảng cách co dần: nhịp đầu thưa, cuối dồn.
    playUi("pulse", seconds * (1 - Math.pow(1 - u, 1.6)) * 0.92, u);
  }
}

const HOVERABLE = "button, [role='tab'], summary, a[href], .skin-tile";

/** Gắn tiếng rê chuột, bấm nút cho cả ứng dụng (sảnh và trong trận). Gọi một lần, trả về hàm gỡ. */
export function installUiSounds(): () => void {
  const unlock = unlockAudioOnGesture();
  let hovered: Element | null = null;
  let lastTick = 0;
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element | null)?.closest?.(HOVERABLE) ?? null;
    if (el === hovered) return;
    hovered = el;
    if (!el || (el as HTMLButtonElement).disabled) return;
    const now = performance.now();
    // Lướt nhanh qua cả dãy nút: không thành tràng tích tích liên tục.
    if (now - lastTick < 45) return;
    lastTick = now;
    playUi("tick");
  };
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.("button, [role='tab'], summary");
    if (!el || (el as HTMLButtonElement).disabled) return;
    playUi(el.closest("[data-ui='clack']") ? "clack" : "click");
  };
  window.addEventListener("pointerover", onOver, { passive: true });
  window.addEventListener("click", onClick, { passive: true });
  return () => {
    unlock();
    window.removeEventListener("pointerover", onOver);
    window.removeEventListener("click", onClick);
  };
}
