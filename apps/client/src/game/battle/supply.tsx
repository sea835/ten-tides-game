import { useEffect, useMemo, useRef, useState } from "react";
import { SUPPLY, nearestSupply, supplyLimited, supplyStations } from "@tentides/content";
import type { IslandRoom } from "../../net.ts";
import { look } from "../input.ts";
import { localPosition } from "../shared.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { mapOfKey, useMapKey } from "../world.ts";

// Trạm tiếp tế (Sinh tồn / Đồng đội, content/supply.ts): giữa trận chỉ mua được khi đứng gần trạm hay thùng thính đã
// chạm đất. Client tính cùng luật với server (shop.ts) để khoá cửa hàng sẵn, chỉ hướng tới trạm gần nhất, và vẽ trạm
// lên bản đồ. Server vẫn kiểm tra lại mọi lần mua.

const DIRS = ["Bắc", "Đông Bắc", "Đông", "Đông Nam", "Nam", "Tây Nam", "Tây", "Tây Bắc"];

export interface SupplyInfo {
  /** Chế độ có giới hạn mua theo trạm (Sinh tồn, Đồng đội). */
  limited: boolean;
  /** Mua được ngay ở chỗ đang đứng. */
  ok: boolean;
  /** Đang chuẩn bị (pha "prep") ở chế độ có trạm: mua ở đâu cũng được, sắp bị giới hạn. */
  prep: boolean;
  /** Khoảng cách (m) và hướng (yaw theo quy ước của `look`) tới điểm mua gần nhất; NaN nếu không có. */
  d: number;
  yaw: number;
  /** Hướng la bàn tới điểm đó ("Đông Bắc"...). */
  dir: string;
}

/** Trạm tiếp tế của bản đồ hiện tại (rỗng nếu chế độ không dùng trạm). */
function useStations(room: IslandRoom) {
  const key = useMapKey(room);
  const seed = useRoomSnapshot(room, (s) => s.worldSeed);
  const mode = useRoomSnapshot(room, (s) => s.battleMode);
  return useMemo(() => (supplyLimited(mode) ? supplyStations(mapOfKey(key, seed), seed) : []), [key, seed, mode]);
}

/** Mua được ở chỗ đang đứng không, trạm gần nhất ở đâu (tính lại 4 lần mỗi giây). */
export function useSupply(room: IslandRoom): SupplyInfo {
  const stations = useStations(room);
  const st = useRoomSnapshot(room, (s) => ({ mode: s.battleMode, phase: s.phase }));
  const limited = supplyLimited(st.mode) && st.phase === "battle";
  const prep = supplyLimited(st.mode) && st.phase === "prep";
  const [info, setInfo] = useState<SupplyInfo>({ limited: false, ok: true, prep: false, d: NaN, yaw: 0, dir: "" });
  useEffect(() => {
    const update = () => {
      const drops = [...room.state.airdrops.values()].filter((a) => a.landed).map((a) => ({ x: a.x, z: a.z }));
      const near = limited ? nearestSupply([...stations, ...drops], localPosition.x, localPosition.z) : null;
      const dx = near ? near.x - localPosition.x : 0;
      const dz = near ? near.z - localPosition.z : 0;
      const bearing = Math.atan2(dx, -dz);
      const next: SupplyInfo = {
        limited,
        prep,
        ok: !limited || (!!near && near.d <= SUPPLY.radius),
        d: near ? Math.round(near.d / 5) * 5 : NaN,
        // Cùng quy ước với look.yaw: yaw 0 nhìn về −z (phía Bắc trên bản đồ).
        yaw: Math.atan2(-dx, -dz),
        dir: near ? DIRS[(Math.round(bearing / (Math.PI / 4)) + 8) % 8]! : "",
      };
      setInfo((prev) => (prev.limited === next.limited && prev.prep === next.prep && prev.ok === next.ok && prev.d === next.d && prev.dir === next.dir && Math.abs(prev.yaw - next.yaw) < 0.05 ? prev : next));
    };
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [room, stations, limited, prep]);
  return info;
}

/** Mũi tên chỉ về trạm gần nhất, xoay theo hướng đang nhìn (lên trên là phía trước mặt; quay người thì xoay theo). */
export function SupplyArrow({ yaw }: { yaw: number }) {
  const el = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (el.current) el.current.style.transform = `rotate(${(((look.yaw - yaw) * 180) / Math.PI).toFixed(1)}deg)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [yaw]);
  return (
    <svg ref={el} className="b-supply-arrow" viewBox="-10 -10 20 20" aria-hidden>
      <path d="M0,-8 L6,6 L0,2.5 L-6,6 Z" />
    </svg>
  );
}

/** Dòng nhắc dưới số tiền: ở trạm thì mua được, không thì trạm gần nhất bao xa, hướng nào. */
export function SupplyHint({ room }: { room: IslandRoom }) {
  const s = useSupply(room);
  if (!s.limited) return null;
  if (s.ok) return <span className="b-supply ok">Đang ở trạm tiếp tế · mua được</span>;
  return (
    <span className="b-supply">
      {Number.isFinite(s.d) && <SupplyArrow yaw={s.yaw} />}
      {Number.isFinite(s.d) ? `Trạm tiếp tế ${s.d} m · ${s.dir}` : "Không còn trạm tiếp tế"}
    </span>
  );
}

/** Lý do cửa hàng đang khoá (null nếu mua được): hiện đầu cửa hàng kèm hướng tới trạm gần nhất. */
export function ShopLock({ info }: { info: SupplyInfo }) {
  if (info.prep) return <p className="b-buy-note">Đang chuẩn bị: mua ở đâu cũng được. Vào trận rồi chỉ mua được ở trạm tiếp tế (ô cam trên bản đồ) hay cạnh thùng thính đã chạm đất.</p>;
  if (info.ok) return null;
  return (
    <div className="b-buy-lock">
      {Number.isFinite(info.d) && <SupplyArrow yaw={info.yaw} />}
      <span>
        <strong>Đến trạm tiếp tế để mua</strong>
        <small>{Number.isFinite(info.d) ? `Gần nhất cách ${info.d} m về phía ${info.dir}. Thùng thính đã chạm đất cũng là trạm tiếp tế.` : "Thùng thính đã chạm đất cũng là trạm tiếp tế."}</small>
      </span>
    </div>
  );
}

/** Trạm tiếp tế trên bản đồ: vòng tròn tầm mua (đứng trong vòng thì mua được) và dấu thùng hàng ở giữa. */
export function SupplyMarks({ room, u }: { room: IslandRoom; u: number }) {
  const stations = useStations(room);
  return (
    <>
      {stations.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.z})`} className="bm-supply">
          <circle r={SUPPLY.radius} />
          <g transform={`scale(${u})`}>
            <rect x={-6} y={-6} width={12} height={12} rx={2} />
            <path d="M-3.5,0 H3.5 M0,-3.5 V3.5" />
          </g>
        </g>
      ))}
    </>
  );
}
