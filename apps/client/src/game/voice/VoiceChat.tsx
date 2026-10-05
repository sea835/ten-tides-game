import { useEffect, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, Radio, Volume2, VolumeX } from "lucide-react";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping } from "../input.ts";
import { setBattleHud } from "../battle/runtime.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { voice } from "./voiceChat.ts";
import { DEFAULT_VOICE, getVoiceSettings, keyLabel, setVoiceSettings, toggleMuted, useVoiceSettings } from "./voiceSettings.ts";
import "./voice.css";

/** Vẽ lại khi có người bắt đầu / thôi nói, micro đổi trạng thái. */
export function useVoice(): number {
  return useSyncExternalStore(voice.subscribe, voice.snapshot);
}

/**
 * Giọng nói trong trận: nối / ngắt theo phòng, giữ phím để nói (mặc định `) hoặc nói qua bộ đàm (mặc định U),
 * hiện ai đang nói ở góc trái.
 */
export function VoiceChat({ room }: { room: IslandRoom }) {
  useEffect(() => {
    voice.attach(room);
    return () => voice.detach();
  }, [room]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      const set = getVoiceSettings();
      if (!set.enabled) return;
      if (e.code === set.pttKey) voice.setPtt(true, false);
      else if (e.code === set.radioKey) {
        if (!voice.hasRadioMates()) setBattleHud({ toast: { at: performance.now(), text: "Không có đồng đội là người để nói qua bộ đàm" } });
        voice.setPtt(true, true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const set = getVoiceSettings();
      if (e.code === set.pttKey) voice.setPtt(false, false);
      else if (e.code === set.radioKey) voice.setPtt(false, true);
    };
    const onBlur = () => {
      voice.setPtt(false, false);
      voice.setPtt(false, true);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return <VoiceTalkers room={room} />;
}

/** Góc trái: micro của mình (đang nói, bộ đàm, lỗi micro) và tên những người đang nói. */
function VoiceTalkers({ room }: { room: IslandRoom }) {
  useVoice();
  const set = useVoiceSettings();
  const names = useRoomSnapshot(room, (s) => {
    const out: Record<string, string> = {};
    for (const [id, p] of s.players) if (!p.bot) out[id] = p.name;
    return out;
  });
  if (!set.enabled) return null;
  const me = voice.transmitting;
  const talkers = [...voice.talking.entries()].filter(([id]) => names[id] !== undefined && !set.muted.includes(id));
  return (
    <div className="v-talkers">
      {me.on ? (
        <div className={`v-talker me ${me.radio ? "radio" : ""}`}>
          {me.radio ? <Radio size={14} /> : <Mic size={14} />} {me.radio ? "Bộ đàm" : "Đang nói"}
        </div>
      ) : voice.micError ? (
        <div className="v-talker err" title={voice.micError}>
          <MicOff size={14} /> {voice.micError}
        </div>
      ) : (
        <div className="v-talker hint">
          <Mic size={13} /> {set.openMic ? "Micro mở" : `Giữ ${keyLabel(set.pttKey)} để nói`} · {keyLabel(set.radioKey)} bộ đàm
        </div>
      )}
      {talkers.map(([id, t]) => (
        <div key={id} className={`v-talker ${t.radio ? "radio" : ""}`}>
          {t.radio ? <Radio size={14} /> : <Mic size={14} />} {names[id]}
        </div>
      ))}
    </div>
  );
}

/** Dấu đang nói / đã tắt tiếng cạnh tên trong bảng điểm. */
export function SpeakingMark({ id }: { id: string }) {
  useVoice();
  const set = useVoiceSettings();
  if (set.muted.includes(id)) return <VolumeX className="v-mark muted" size={13} aria-label="Đã tắt tiếng" />;
  if (!voice.isTalking(id)) return null;
  return voice.talking.get(id)?.radio ? <Radio className="v-mark radio" size={13} aria-label="Đang nói qua bộ đàm" /> : <Mic className="v-mark" size={13} aria-label="Đang nói" />;
}

/** Nút đổi phím: bấm rồi nhấn phím mới (Esc huỷ). */
function KeyButton({ code, onPick }: { code: string; onPick: (code: string) => void }) {
  const [wait, setWait] = useState(false);
  useEffect(() => {
    if (!wait) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setWait(false);
      if (e.code !== "Escape") onPick(e.code);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [wait, onPick]);
  return (
    <button className={`v-key ${wait ? "wait" : ""}`} onClick={() => setWait(true)}>
      {wait ? "Nhấn phím…" : keyLabel(code)}
    </button>
  );
}

/** Mục "Giọng nói" trong bảng Cài đặt. */
export function VoiceSettingsSection() {
  const set = useVoiceSettings();
  useVoice();
  const room = voice.room;
  return (
    <>
      <div className="b-set-title">Giọng nói</div>
      <label className="b-set-check">
        <input type="checkbox" checked={set.enabled} onChange={(e) => setVoiceSettings({ enabled: e.target.checked })} /> Bật trò chuyện bằng giọng nói
      </label>
      {set.enabled && (
        <>
          <label className="b-set-check">
            <input type="checkbox" checked={set.openMic} onChange={(e) => setVoiceSettings({ openMic: e.target.checked })} /> Mở micro luôn (tự phát khi có tiếng nói)
          </label>
          <div className="b-set-row">
            <span>Phím nói (gần)</span>
            <KeyButton code={set.pttKey} onPick={(pttKey) => setVoiceSettings({ pttKey })} />
            <em />
          </div>
          <div className="b-set-row">
            <span>Phím bộ đàm (đội)</span>
            <KeyButton code={set.radioKey} onPick={(radioKey) => setVoiceSettings({ radioKey })} />
            <em />
          </div>
          <label className="b-set-row">
            <span>Âm lượng giọng nói</span>
            <input type="range" min={0} max={1.5} step={0.05} value={set.volume} onChange={(e) => setVoiceSettings({ volume: Number(e.target.value) })} />
            <em>{set.volume === 0 ? "Tắt" : `${Math.round(set.volume * 100)}%`}</em>
          </label>
          {voice.micError && <p className="v-error">{voice.micError}</p>}
          {room && <MuteList room={room} />}
          <button
            className="ghost"
            onClick={() => setVoiceSettings({ openMic: DEFAULT_VOICE.openMic, pttKey: DEFAULT_VOICE.pttKey, radioKey: DEFAULT_VOICE.radioKey, volume: DEFAULT_VOICE.volume })}
          >
            Phím và âm lượng giọng nói mặc định
          </button>
        </>
      )}
    </>
  );
}

/** Danh sách người thật trong phòng, bấm để tắt / bật tiếng từng người. */
function MuteList({ room }: { room: IslandRoom }) {
  const set = useVoiceSettings();
  const me = myId(room);
  const people = useRoomSnapshot(room, (s) =>
    [...s.players.entries()]
      .filter(([id, p]) => !p.bot && id !== me)
      .map(([id, p]) => ({ id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  if (!people.length) return <p className="v-none">Chưa có ai khác trong phòng để nghe.</p>;
  return (
    <div className="v-mute">
      {people.map((p) => {
        const muted = set.muted.includes(p.id);
        return (
          <button key={p.id} className={muted ? "muted" : ""} onClick={() => toggleMuted(p.id)} title={muted ? "Bật lại tiếng" : "Tắt tiếng người này"}>
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} {p.name}
            {voice.isTalking(p.id) && !muted && <Mic size={12} className="v-mark" />}
          </button>
        );
      })}
    </div>
  );
}
