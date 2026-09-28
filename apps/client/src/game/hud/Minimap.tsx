import { useMemo } from "react";
import { ANCHORS, CAVE, LAKE, MAP_HALF_SIZE, TREASURE_SITES, VOLCANO, isletEdge, shoreRadius, structureToWorld, worldCatalog, type World } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { useWorld } from "../world.ts";

const SHORE = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  const r = shoreRadius(Math.cos(a) * 100, Math.sin(a) * 100);
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
}).join(" ");

/** Đường bờ của các đảo nhỏ: dò theo từng hướng tới chỗ độ cao bờ bằng 0. */
function isletOutlines(world: World) {
  return world.islets.map((it) => {
    const points = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      let lo = 0;
      let hi = it.radius * 1.6;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (isletEdge(it, it.x + Math.cos(a) * mid, it.z + Math.sin(a) * mid) > 0) lo = mid;
        else hi = mid;
      }
      return `${(it.x + Math.cos(a) * lo).toFixed(1)},${(it.z + Math.sin(a) * lo).toFixed(1)}`;
    }).join(" ");
    return { id: it.id, kind: it.kind, points, lagoon: it.kind === "atoll" ? { x: it.x, z: it.z, r: Math.max(0, it.radius - Math.max(5, it.radius * 0.34) - 2) } : null };
  });
}

/** Bản đồ nhỏ nhìn từ trên xuống, bắc ở trên: đảo chính, đảo nhỏ, hang, hầm, trại, điểm sự kiện và mọi người. */
export function Minimap({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const world = useWorld(room);
  const outlines = useMemo(() => isletOutlines(world), [world]);
  const structures = useMemo(
    () => world.structures.map((s) => ({ id: s.id, kind: s.kind, name: s.name, at: structureToWorld(s, 0, 0) })),
    [world],
  );
  const view = useRoomSnapshot(room, (s) => ({
    site: s.treasureSite && !s.treasureDug ? s.treasureSite : "",
    camp: s.campPacked ? null : { x: Math.round(s.campX), z: Math.round(s.campZ) },
    // Làm tròn vị trí để bản đồ chỉ vẽ lại khi ai đó đi được một đoạn.
    // Người khác đang ngồi nấp trong cỏ cao thì không hiện chấm.
    players: [...s.players.entries()]
      .filter(([id, p]) => id === me || !p.sitting || !world.inTallGrass(p.x, p.z))
      .map(([id, p]) => ({
        id,
        x: Math.round(p.x / 3) * 3,
        z: Math.round(p.z / 3) * 3,
        color: p.color,
        alive: p.alive,
      })),
    anchors:
      s.phase === "dawn" || s.phase === "explore"
        ? [...s.anchors.entries()].filter(([, a]) => a.status !== "resolved").map(([id, a]) => ({ id, active: a.status === "active" }))
        : [],
    found: [...s.discovered],
    traps: [...s.traps.values()].map((t) => ({ x: Math.round(t.x), z: Math.round(t.z) })),
  }));
  const found = new Set(view.found);
  const H = MAP_HALF_SIZE;

  return (
    <svg className="minimap" viewBox={`${-H} ${-H} ${H * 2} ${H * 2}`} aria-label="Bản đồ đảo và vùng biển quanh đảo">
      {world.reefs.map((r) => (
        <circle key={r.id} cx={r.x} cy={r.z} r={r.radius} className="mm-reef" />
      ))}
      {outlines.map((o) => (
        <g key={o.id}>
          <polygon points={o.points} className={`mm-islet ${o.kind}`} />
          {o.lagoon && <circle cx={o.lagoon.x} cy={o.lagoon.z} r={o.lagoon.r} className="mm-lagoon" />}
        </g>
      ))}
      <polygon points={SHORE} className="mm-land" />
      <circle cx={LAKE.x} cy={LAKE.z} r={LAKE.radius} className="mm-lake" />
      <circle cx={VOLCANO.x} cy={VOLCANO.z} r={VOLCANO.radius * 0.7} className="mm-volcano" />
      <circle cx={VOLCANO.x} cy={VOLCANO.z} r={VOLCANO.craterRadius} className="mm-crater" />
      <rect x={CAVE.x - 6} y={CAVE.z - 10} width={12} height={16} className="mm-cave" />
      {structures.map((s) => (
        <g key={s.id} transform={`translate(${s.at.x.toFixed(1)} ${s.at.z.toFixed(1)})`}>
          <title>{s.name}</title>
          {s.kind === "cave" ? <polygon points="-7,5 0,-7 7,5" className="mm-cave" /> : <rect x={-5} y={-5} width={10} height={10} className="mm-mine" />}
        </g>
      ))}
      {view.camp && <circle cx={view.camp.x} cy={view.camp.z} r={6} className="mm-camp" />}
      {world.pois
        .filter((p) => found.has(p.id))
        .map((p) => (
          <text key={p.id} x={p.x} y={p.z + 5} className={p.kind === "egg" ? "mm-egg" : "mm-anomaly"} textAnchor="middle">
            <title>{worldCatalog.pois.get(p.defId)?.name}</title>★
          </text>
        ))}
      {view.traps.map((t, i) => (
        <text key={i} x={t.x} y={t.z + 5} className="mm-trap" textAnchor="middle">
          !
        </text>
      ))}
      {view.anchors.map((a) => {
        const anchor = ANCHORS.find((x) => x.id === a.id);
        return anchor ? <circle key={a.id} cx={anchor.x} cy={anchor.z} r={6} className={a.active ? "mm-anchor active" : "mm-anchor"} /> : null;
      })}
      {(() => {
        const t = TREASURE_SITES.find((x) => x.id === view.site);
        return t ? (
          <text x={t.x} y={t.z + 8} className="mm-x" textAnchor="middle">
            ✕
          </text>
        ) : null;
      })()}
      {view.players.map((p) => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.z}
          r={p.id === me ? 9 : 7}
          fill={p.color}
          className={p.id === me ? "mm-me" : p.alive ? "mm-player" : "mm-player dead"}
        />
      ))}
    </svg>
  );
}
