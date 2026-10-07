import { audio, noiseBurst, tone, type Place } from "./engine.ts";

// Tiếng chi viện chiến thuật: còi báo động phòng không (mưa pháo sắp rơi), tiếng UAV lượn trên trời, tiếng quay nòng
// Minigun, tiếng "đủ điểm" trên bộ đàm. Tiếng rít đạn pháo dùng chung với cối (mortar.ts).

/**
 * Còi báo động phòng không ở `at` trong `seconds` giây: tiếng hú lên xuống (dao động răng cưa qua lọc thấp), nghe xa
 * `hearing` mét.
 */
export function playSiren(at: Place, seconds: number, hearing = 200) {
  try {
    const out = audio.output("sfx", 0.5, at, hearing);
    if (!out) return;
    const ctx = audio.ctx!;
    const t = ctx.currentTime;
    const dur = Math.max(1, Math.min(7.5, seconds));
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    g.gain.setValueAtTime(0.35, t + dur - 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Hú: lên chậm, xuống chậm, mỗi vòng chừng hai giây.
    const cycle = 2.2;
    osc.frequency.setValueAtTime(260, t);
    for (let c = 0; c * cycle < dur; c++) {
      osc.frequency.linearRampToValueAtTime(820, t + c * cycle + cycle * 0.55);
      osc.frequency.linearRampToValueAtTime(320, t + (c + 1) * cycle);
    }
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Minigun quay nòng: tiếng rít điện tăng dần trong `ms` mili giây (tiếng của mình, ngay tai). */
export function playMinigunSpin(ms: number) {
  try {
    const out = audio.output("sfx", 0.45);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    const dur = ms / 1000;
    tone(out, t, { type: "sawtooth", freq: 120, freqEnd: 900, attack: dur * 0.9, peak: 0.12, decay: 0.25 });
    noiseBurst(out, t, { type: "bandpass", freq: 600, freqEnd: 3000, q: 2, attack: dur * 0.9, peak: 0.18, decay: 0.2 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Chi viện vừa được gọi / UAV lên trời: ba nốt bộ đàm (bus giao diện). `bad`: địch gọi (nốt trầm, gắt). */
export function playStreakCall(bad = false) {
  try {
    const out = audio.output("ui", 0.5);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    const notes = bad ? [520, 390, 300] : [660, 880, 1100];
    notes.forEach((f, k) => tone(out, t + k * 0.11, { type: bad ? "square" : "triangle", freq: f, decay: 0.12, peak: bad ? 0.18 : 0.35 }));
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}

/** Đủ điểm cho một chi viện mới: tiếng "ting" ngắn. */
export function playStreakReady() {
  try {
    const out = audio.output("ui", 0.45);
    if (!out) return;
    const t = audio.ctx!.currentTime;
    tone(out, t, { type: "sine", freq: 1320, decay: 0.25, peak: 0.4 });
    tone(out, t + 0.09, { type: "sine", freq: 1980, decay: 0.35, peak: 0.3 });
  } catch {
    // Lỗi âm thanh thì im lặng bỏ qua.
  }
}
