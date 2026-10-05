import { audio, noiseBurst, tone, type Place } from "./engine.ts";

// Tiếng cối 82 ly: phát bắn "thụp" trầm, rỗng (đạn trượt trong ống rồi bật ra), tiếng nạp đạn lách cách; đạn sắp rơi
// thì rít dài, cao rồi trầm dần (người quanh chỗ rơi nghe thấy kịp nằm xuống). Cùng kiểu tiếng ngắn ở motors.ts.

/** Cối bắn: tiếng thụp trầm (nghe xa), lách cách kim loại. */
export function playMortarFire(at: Place, local = false) {
  try {
    const out = audio.output("sfx", local ? 1 : 0.9, at, 320);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    tone(out, t, { type: "sine", freq: 95, freqEnd: 38, peak: 1, decay: 0.45 });
    tone(out, t, { type: "triangle", freq: 210, freqEnd: 70, peak: 0.35, decay: 0.18 });
    noiseBurst(out, t, { brown: true, type: "lowpass", freq: 900, freqEnd: 200, peak: 0.9, decay: 0.5 });
    noiseBurst(out, t + 0.01, { type: "bandpass", freq: 2200, q: 1.2, peak: 0.25, decay: 0.06 });
    if (local) for (let k = 0; k < 2; k++) tone(out, t + 0.5 + k * 0.12, { type: "square", freq: 900 + Math.random() * 400, peak: 0.06, decay: 0.05 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Đạn cối sắp rơi ở `at` sau `seconds` giây: tiếng rít trượt từ cao xuống trầm, to dần tới lúc chạm đất. */
export function playMortarWhistle(at: Place, seconds: number) {
  try {
    const out = audio.output("sfx", 0.55, at, 140);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    const dur = Math.max(0.4, Math.min(2.5, seconds));
    // Rít: tăng dần (attack gần hết thời gian bay còn lại), tắt ngay trước tiếng nổ.
    tone(out, t, { type: "sine", freq: 1650, freqEnd: 520, attack: dur * 0.92, peak: 0.32, decay: 0.08 });
    tone(out, t, { type: "sine", freq: 1700, freqEnd: 540, attack: dur * 0.92, peak: 0.12, decay: 0.08, detune: 25 });
    noiseBurst(out, t, { type: "bandpass", freq: 2600, freqEnd: 900, q: 3, attack: dur * 0.9, peak: 0.12, decay: 0.1 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}
