import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Callbacks } from "@colyseus/sdk";
import { BoxGeometry, CylinderGeometry, DoubleSide, MeshStandardMaterial, SphereGeometry, type Group } from "three";
import { AIRDROP } from "@tentides/content";
import type { AirdropState } from "@tentides/protocol";
import type { IslandRoom } from "../../net.ts";
import { localPosition } from "../shared.ts";
import { play } from "../sound/sfx.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { puffs } from "./Effects.tsx";

// Thùng thính: thùng gỗ bọc góc thép treo dưới chiếc dù sọc đỏ trắng, lắc lư chậm rãi trên đường rơi; chạm đất
// thì dù xẹp xuống, khói đỏ cuộn cao lên trời cho cả đảo thấy. Đồ trong thùng đổ ra quanh thùng thành đồ dưới
// đất (vẽ và nhặt như mọi món khác). Trên HUD: thông báo lúc thùng bắt đầu rơi, dấu trên bản đồ nhỏ và bản đồ lớn.

const crateGeo = new BoxGeometry(1.2, 1, 1.2);
const edgeGeo = new BoxGeometry(1.26, 0.12, 1.26);
const postGeo = new BoxGeometry(0.12, 1.02, 0.12);
const bandGeo = new BoxGeometry(1.22, 0.22, 1.22);
/** Tán dù: nửa trên quả cầu dẹt, hở đáy. */
const canopyGeo = new SphereGeometry(3.4, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1, 0.6, 1);
const lineGeo = new CylinderGeometry(0.015, 0.015, 1, 3).translate(0, 0.5, 0);

const wood = new MeshStandardMaterial({ color: "#7a5a32", roughness: 0.85 });
const steel = new MeshStandardMaterial({ color: "#3b4046", roughness: 0.45, metalness: 0.7 });
const band = new MeshStandardMaterial({ color: "#d8342a", roughness: 0.6, emissive: "#5a0c08", emissiveIntensity: 0.4 });
const canopyMat = new MeshStandardMaterial({ color: "#e84a3a", roughness: 0.8, side: DoubleSide });
const canopyStripe = new MeshStandardMaterial({ color: "#f2efe6", roughness: 0.8, side: DoubleSide });
const lineMat = new MeshStandardMaterial({ color: "#222", roughness: 1 });
/** Sọc trắng: cùng tán dù, xoay lệch nửa múi, nhỏ hơn một chút cho khỏi nhấp nháy. */
const stripeGeo = new SphereGeometry(3.38, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1, 0.6, 1);

/** Dây dù: từ bốn góc thùng lên mép tán. */
const LINES: [number, number, number, number][] = [
  [0.55, 0.55, 2.2, 2.2],
  [-0.55, 0.55, -2.2, 2.2],
  [0.55, -0.55, 2.2, -2.2],
  [-0.55, -0.55, -2.2, -2.2],
];
const CANOPY_Y = 7;

function Crate({ room, id }: { room: IslandRoom; id: string }) {
  const group = useRef<Group>(null);
  const chute = useRef<Group>(null);
  const smokeAcc = useRef(0);
  /** Độ xẹp của dù sau khi chạm đất (1 là còn căng). */
  const open = useRef(1);
  const wasLanded = useRef<boolean | null>(null);
  const [dist, setDist] = useState(0);
  const [landed, setLanded] = useState(false);
  const lines = useMemo(
    () =>
      LINES.map(([x0, z0, x1, z1]) => {
        const dx = x1 - x0;
        const dz = z1 - z0;
        // Mép tán cao hơn tâm dù chừng nửa mét; dây mọc từ nóc thùng (cao 1 m).
        const dy = CANOPY_Y + 0.5 - 1;
        const len = Math.hypot(dx, dy, dz);
        // Dây dựng dọc trục y: nghiêng về phía mép tán.
        return { pos: [x0, 1, z0] as const, len, rx: Math.atan2(dz, dy), rz: -Math.atan2(dx, Math.hypot(dy, dz)) };
      }),
    [],
  );
  useFrame(({ clock }, rawDt) => {
    const a = room.state.airdrops.get(id) as AirdropState | undefined;
    const g = group.current;
    if (!a || !g) return;
    const dt = Math.min(rawDt, 0.05);
    // Server gửi độ cao 20 lần mỗi giây: bám mượt theo, không giật.
    g.position.x = a.x;
    g.position.z = a.z;
    g.position.y += (a.y - g.position.y) * Math.min(1, dt * 10);
    if (Math.abs(a.y - g.position.y) > 8) g.position.y = a.y;
    const t = clock.elapsedTime;
    if (!a.landed) {
      // Lắc lư dưới dù.
      g.rotation.x = Math.sin(t * 0.9 + a.x) * 0.06;
      g.rotation.z = Math.cos(t * 0.7 + a.z) * 0.06;
      g.rotation.y += dt * 0.15;
    } else {
      g.rotation.x = g.rotation.z = 0;
      open.current = Math.max(0, open.current - dt * 0.8);
    }
    const c = chute.current;
    if (c) {
      const k = open.current;
      c.visible = k > 0.01;
      c.scale.set(1 + (1 - k) * 0.3, Math.max(0.05, k), 1 + (1 - k) * 0.3);
      c.position.y = 1 + (CANOPY_Y - 1) * k;
      c.position.x = (1 - k) * 2.5;
    }
    if (wasLanded.current !== a.landed) {
      // Chạm đất ngay trước mắt thì nghe tiếng thùng đập đất; vào giữa trận thấy thùng đã nằm đất thì dù xẹp sẵn.
      if (wasLanded.current === false) play("thud", { at: { x: a.x, y: a.ground, z: a.z }, volume: 1.4, hearing: 120 });
      else if (a.landed) open.current = 0;
      wasLanded.current = a.landed;
      setLanded(a.landed);
    }
    // Khói đỏ: cột khói cao, trôi nhẹ theo gió, bớt dần lúc gần hết giờ.
    if (a.landed && a.smoke > 0) {
      smokeAcc.current += dt;
      const rate = a.smoke > 10 ? 6 : 2;
      while (smokeAcc.current > 1 / rate) {
        smokeAcc.current -= 1 / rate;
        const shade = 0.85 + Math.random() * 0.15;
        puffs.push({
          x: a.x + (Math.random() - 0.5) * 0.4,
          y: a.ground + 1.1,
          z: a.z + (Math.random() - 0.5) * 0.4,
          vx: 0.5 + (Math.random() - 0.5) * 0.6,
          vy: 2.4 + Math.random() * 1.2,
          vz: (Math.random() - 0.5) * 0.6,
          size: 0.9,
          grow: 1.1,
          life: 9 + Math.random() * 3,
          age: 0,
          r: shade,
          g: 0.18 * shade,
          b: 0.14 * shade,
          alpha: 0.75,
          dense: false,
        });
      }
    }
    // Khoảng cách tới thùng cho nhãn nổi (làm tròn 10 m, chỉ đổi state khi khác).
    const d = Math.round(Math.hypot(a.x - localPosition.x, a.z - localPosition.z) / 10) * 10;
    if (d !== dist) setDist(d);
  });
  return (
    <group ref={group}>
      <group position-y={0.5}>
        <mesh geometry={crateGeo} material={wood} castShadow receiveShadow />
        <mesh geometry={edgeGeo} material={steel} position-y={0.46} />
        <mesh geometry={edgeGeo} material={steel} position-y={-0.46} />
        <mesh geometry={bandGeo} material={band} />
        {[
          [0.58, 0.58],
          [-0.58, 0.58],
          [0.58, -0.58],
          [-0.58, -0.58],
        ].map(([x, z], i) => (
          <mesh key={i} geometry={postGeo} material={steel} position={[x!, 0, z!]} />
        ))}
      </group>
      <group ref={chute} position-y={CANOPY_Y}>
        <mesh geometry={canopyGeo} material={canopyMat} castShadow />
        <mesh geometry={stripeGeo} material={canopyStripe} rotation-y={Math.PI / 8} scale={[1, 1.01, 1]} />
      </group>
      {!landed &&
        lines.map((l, i) => <mesh key={i} geometry={lineGeo} material={lineMat} position={l.pos} rotation={[l.rx, 0, l.rz]} scale={[1, l.len, 1]} />)}
      {dist > 30 && (
        <Html position={[0, landed ? 4 : CANOPY_Y + 3, 0]} center zIndexRange={[3, 0]} className="b-drop-tag">
          📦 {dist} m
        </Html>
      )}
    </group>
  );
}

/** Mọi thùng thính trong trận (vẽ trong cảnh 3D). */
export function AirdropCrates({ room }: { room: IslandRoom }) {
  const ids = useRoomSnapshot(room, (s) => [...s.airdrops.keys()]);
  return (
    <>
      {ids.map((id) => (
        <Crate key={id} room={room} id={id} />
      ))}
    </>
  );
}

/** Dấu thùng thính trên bản đồ nhỏ / bản đồ lớn (nằm trong thẻ svg của bản đồ, toạ độ thế giới). */
export function AirdropMarks({ room, big }: { room: IslandRoom; big?: boolean }) {
  const s = big ? 1 : 1.4;
  return (
    <>
      {[...room.state.airdrops.entries()].map(([id, a]) => (
        <g key={id} transform={`translate(${a.x} ${a.z}) scale(${s})`} className={a.landed ? "bm-drop landed" : "bm-drop"}>
          <rect x={-5} y={-5} width={10} height={10} rx={1.5} />
          <path d="M-5,0 H5 M0,-5 V5" />
        </g>
      ))}
    </>
  );
}

/** Thông báo giữa màn hình khi máy bay vừa thả thùng thính (kèm tiếng báo). */
export function AirdropNotice({ room }: { room: IslandRoom }) {
  const [shown, setShown] = useState<{ at: number; x: number; z: number } | null>(null);
  useEffect(() => {
    const cb = Callbacks.get(room);
    return cb.onAdd("airdrops", (a: AirdropState) => {
      // Vào giữa trận thấy thùng đã nằm đất thì thôi báo. Thùng chi viện (điểm chiến thuật) rơi từ 60% thời gian:
      // StreakHud báo riêng.
      if (a.landed || a.fallLeft < AIRDROP.fall * 0.7) return;
      setShown({ at: performance.now(), x: a.x, z: a.z });
      play("dawn", { bus: "ui", volume: 0.7 });
    });
  }, [room]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  const d = Math.round(Math.hypot(shown.x - localPosition.x, shown.z - localPosition.z));
  return (
    <div className="b-airdrop">
      <b>📦 Thùng thính đang rơi!</b>
      <span>Cách {d} m · đồ xịn: súng hiếm, giáp mũ cấp 3, ống ngắm xa · xem dấu đỏ trên bản đồ (M)</span>
    </div>
  );
}
