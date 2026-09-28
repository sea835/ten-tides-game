import { ANCHORS, CAMP, CAVE, LAKE, TREASURE_SITES, VOLCANO, shoreRadius } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";

const SHORE = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  const r = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100);
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
}).join(" ");

/** Bản đồ nhỏ nhìn từ trên xuống, bắc ở trên: đảo, trại, điểm sự kiện đang chờ và vị trí mọi người. */
export function Minimap({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const view = useRoomSnapshot(room, (s) => ({
    site: s.treasureSite && !s.treasureDug ? s.treasureSite : "",
    // Làm tròn vị trí để bản đồ chỉ vẽ lại khi ai đó đi được một đoạn.
    players: [...s.players.entries()].map(([id, p]) => ({
      id,
      x: Math.round(p.x / 2) * 2,
      z: Math.round(p.z / 2) * 2,
      color: p.color,
      alive: p.alive,
    })),
    anchors:
      s.phase === "dawn" || s.phase === "explore"
        ? [...s.anchors.entries()].filter(([, a]) => a.status !== "resolved").map(([id, a]) => ({ id, active: a.status === "active" }))
        : [],
  }));

  return (
    <svg className="minimap" viewBox="-115 -115 230 230" aria-label="Bản đồ đảo">
      <polygon points={SHORE} className="mm-land" />
      <circle cx={LAKE.x} cy={LAKE.z} r={LAKE.radius} className="mm-lake" />
      <circle cx={VOLCANO.x} cy={VOLCANO.z} r={VOLCANO.radius * 0.7} className="mm-volcano" />
      <circle cx={VOLCANO.x} cy={VOLCANO.z} r={VOLCANO.craterRadius} className="mm-crater" />
      <rect x={CAVE.x - 6} y={CAVE.z - 10} width={12} height={16} className="mm-cave" />
      <circle cx={CAMP.x} cy={CAMP.z} r={5} className="mm-camp" />
      {view.anchors.map((a) => {
        const anchor = ANCHORS.find((x) => x.id === a.id);
        return anchor ? <circle key={a.id} cx={anchor.x} cy={anchor.z} r={4} className={a.active ? "mm-anchor active" : "mm-anchor"} /> : null;
      })}
      {(() => {
        const t = TREASURE_SITES.find((x) => x.id === view.site);
        return t ? (
          <text x={t.x} y={t.z + 5} className="mm-x" textAnchor="middle">
            ✕
          </text>
        ) : null;
      })()}
      {view.players.map((p) => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.z}
          r={p.id === me ? 6 : 4.5}
          fill={p.color}
          className={p.id === me ? "mm-me" : p.alive ? "mm-player" : "mm-player dead"}
        />
      ))}
    </svg>
  );
}
