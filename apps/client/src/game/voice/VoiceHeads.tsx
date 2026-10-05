import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, Group, Sprite, SpriteMaterial } from "three";
import { VOICE_RANGE } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { bodies } from "../battle/runtime.ts";
import { localPosition } from "../shared.ts";
import { voice, type TalkState } from "./voiceChat.ts";
import { getVoiceSettings } from "./voiceSettings.ts";

// Biểu tượng micro trên đầu người đang nói: một bộ sprite cố định (không tạo mới mỗi khung hình), đặt lại vị trí theo
// thân đang vẽ. Nói thường thì chỉ hiện trong tầm nghe; nói qua bộ đàm thì đồng đội thấy ở mọi khoảng cách.

const POOL = 8;
const HEAD = 2.6;

function micTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(10,16,22,0.78)";
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.fillStyle = "#ffffff";
  g.lineWidth = 4;
  g.lineCap = "round";
  // Thân micro.
  g.beginPath();
  g.roundRect(25, 13, 14, 24, 7);
  g.fill();
  // Gọng và chân.
  g.beginPath();
  g.arc(32, 30, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.beginPath();
  g.moveTo(32, 42);
  g.lineTo(32, 50);
  g.moveTo(25, 51);
  g.lineTo(39, 51);
  g.stroke();
  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function VoiceHeads({ room }: { room: IslandRoom }) {
  const group = useRef<Group>(null);
  const { sprites, tex } = useMemo(() => {
    const tex = micTexture();
    const sprites: Sprite[] = [];
    for (let i = 0; i < POOL; i++) {
      const s = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      s.scale.setScalar(0.42);
      s.visible = false;
      s.renderOrder = 10;
      sprites.push(s);
    }
    return { sprites, tex };
  }, []);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const s of sprites) g.add(s);
    return () => {
      for (const s of sprites) {
        g.remove(s);
        s.material.dispose();
      }
      tex.dispose();
    };
  }, [sprites, tex]);

  // Duyệt Map bằng forEach với hàm dựng sẵn: không cấp phát gì mỗi khung hình.
  const state = useRef({ used: 0, myTeam: "", muted: [] as string[], pulse: 1 });
  const place = useMemo(
    () => (talk: TalkState, id: string) => {
      const st = state.current;
      if (st.used >= POOL || st.muted.includes(id)) return;
      const b = bodies.get(id);
      if (!b || !b.alive) return;
      const mate = !!st.myTeam && b.team === st.myTeam;
      const d = Math.hypot(b.x - localPosition.x, b.z - localPosition.z);
      if (d > VOICE_RANGE && !(talk.radio && mate)) return;
      const s = sprites[st.used++]!;
      s.visible = true;
      s.position.set(b.x, b.y + (b.prone ? 1.2 : b.crouch ? 2.0 : HEAD), b.z);
      // To dần theo khoảng cách để ở xa vẫn thấy; bộ đàm tô xanh lá.
      s.scale.setScalar((0.32 + d * 0.012) * st.pulse);
      s.material.color.set(talk.radio && mate ? 0x8dff9a : 0xffffff);
    },
    [sprites],
  );

  useFrame(() => {
    const st = state.current;
    st.used = 0;
    st.muted = getVoiceSettings().muted;
    st.myTeam = room.state.players.get(myIdCache(room))?.team ?? "";
    st.pulse = 1 + Math.sin(performance.now() * 0.012) * 0.08;
    if (getVoiceSettings().enabled) voice.talking.forEach(place);
    for (let i = st.used; i < POOL; i++) sprites[i]!.visible = false;
  });

  return <group ref={group} />;
}

/** Id của mình, dò lại khi phiên kết nối đổi (vào lại sau khi rớt mạng). */
const idCache = { session: "", id: "" };
function myIdCache(room: IslandRoom): string {
  if (idCache.session !== room.sessionId || !idCache.id) {
    idCache.session = room.sessionId;
    idCache.id = "";
    for (const [id, p] of room.state.players) if (p.sessionId === room.sessionId) idCache.id = id;
  }
  return idCache.id;
}
