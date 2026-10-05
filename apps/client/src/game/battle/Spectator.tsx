import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { MAP_HALF_SIZE, WEAPON } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { isTyping, keys, view } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { currentWorld } from "../world.ts";
import { RankBadge } from "../../progress/RankBadge.tsx";
import { getBattleHud, setBattleHud, useBattleHud } from "./runtime.ts";
import { getKillcam, useKillcam } from "./replay.ts";

// Xem trận sau khi gục (đấu đơn, Đồng đội) hay khi vào phòng lúc trận đang đánh: đổi người xem bằng Q/E hay chuột
// trái/phải (còn sống thì Q/E là nghiêng người), Space bật camera tự do (WASD + chuột, Shift bay nhanh, không ra khỏi
// bản đồ), dải thông tin người đang xem (tên, quân hàm, máu, súng). Chiến trường có hồi sinh nên không dùng.

interface SpectateState {
  /** Camera tự do (bay lượn) thay vì bám theo người đang xem. */
  freeCam: boolean;
  /** Thu gọn bảng "Bạn đã gục" để xem trận cho thoáng. */
  watch: boolean;
  /** Đã từng còn sống trong phòng này (chưa thì là người vào giữa trận, đang chờ trận sau). */
  everAlive: boolean;
}

let state: SpectateState = { freeCam: false, watch: false, everAlive: false };
const listeners = new Set<() => void>();

export function getSpectate(): SpectateState {
  return state;
}

export function setSpectate(patch: Partial<SpectateState>) {
  if ((Object.keys(patch) as (keyof SpectateState)[]).every((k) => state[k] === patch[k])) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSpectate(): SpectateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Đổi người xem: `dir` 1 là người kế tiếp, −1 là người trước. Đồng đội: xem người trong đội mình trước. */
export function cycleSpectate(room: IslandRoom, dir: 1 | -1) {
  const team = room.state.players.get(myId(room))?.team ?? "";
  const all = [...room.state.players.entries()].filter(([, p]) => p.alive);
  const mates = team ? all.filter(([, p]) => p.team === team) : [];
  const alive = (mates.length ? mates : all).map(([id]) => id);
  if (!alive.length) return;
  const i = alive.indexOf(getBattleHud().spectating);
  const next = i < 0 ? (dir > 0 ? 0 : alive.length - 1) : (i + dir + alive.length) % alive.length;
  setBattleHud({ spectating: alive[next]! });
}

/** Đang xem trận được không: đã gục, trận đang đánh, không phải chiến trường. */
function watching(room: IslandRoom): boolean {
  const st = room.state;
  const p = st.players.get(myId(room));
  return !!p && !p.alive && st.battleMode !== "war" && (st.phase === "battle" || st.phase === "prep");
}

const FLY_SPEED = 14;
const FLY_FAST = 3;
const FLY_TOP = 160;
const pos = new Vector3();
const dir = new Vector3();

/** Khung cảnh: camera tự do khi đang xem trận (sau LocalPlayer, trước khi vẽ). */
export function SpectatorCamera({ room }: { room: IslandRoom }) {
  const fly = useRef({ on: false });
  useFrame(({ camera }, dt) => {
    const p = room.state.players.get(myId(room));
    if (p?.alive) {
      if (!state.everAlive || state.freeCam || state.watch) setSpectate({ everAlive: true, freeCam: false, watch: false });
      fly.current.on = false;
      return;
    }
    if (!state.freeCam || getKillcam() || !watching(room)) {
      fly.current.on = false;
      return;
    }
    if (!fly.current.on) {
      fly.current.on = true;
      // Nhấc lên chút cho thoáng tầm nhìn.
      pos.copy(camera.position);
      pos.y += 2;
    }
    // Hướng nhìn như camera góc ba (chuột xoay `view`): bay theo hướng nhìn, A/D sang ngang.
    const cp = Math.cos(view.pitch);
    dir.set(-Math.sin(view.yaw) * cp, -Math.sin(view.pitch), -Math.cos(view.yaw) * cp);
    const f = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const r = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const speed = FLY_SPEED * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? FLY_FAST : 1) * Math.min(dt, 0.1);
    pos.addScaledVector(dir, f * speed);
    pos.x += Math.cos(view.yaw) * r * speed;
    pos.z -= Math.sin(view.yaw) * r * speed;
    const world = currentWorld(room);
    const h = world.half ?? MAP_HALF_SIZE;
    pos.x = Math.max(-h, Math.min(h, pos.x));
    pos.z = Math.max(-h, Math.min(h, pos.z));
    const ground = Math.max(0, world.heightAt(pos.x, pos.z));
    pos.y = Math.max(ground + 1.2, Math.min(FLY_TOP, pos.y));
    camera.position.copy(pos);
    dir.add(pos);
    camera.lookAt(dir);
  }, -0.4);
  return null;
}

const SLOT_WEAPON = ["primary1", "primary2", "pistol"] as const;

/** Dải dưới màn hình khi đang xem trận: người đang xem, máu, súng; phím đổi người, camera tự do. */
export function SpectatorHud({ room }: { room: IslandRoom }) {
  const hud = useBattleHud();
  const sp = useSpectate();
  const kc = useKillcam();
  const can = useRoomSnapshot(room, () => watching(room));
  const squad = useRoomSnapshot(room, (s) => s.battleMode === "squad");
  const target = useRoomSnapshot(room, (s) => {
    const p = s.players.get(hud.spectating);
    if (!p) return null;
    const slot = p.kit.active;
    const weapon = (SLOT_WEAPON as readonly string[]).includes(slot) ? p.kit[slot as (typeof SLOT_WEAPON)[number]] : "";
    return { name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp || 100, rank: p.badge.rank, weapon: WEAPON.get(weapon)?.name ?? (slot === "" ? "Dao" : slot === "frag" ? "Lựu đạn" : ""), armor: p.kit.armor, helmet: p.kit.helmet };
  });

  // Vào phòng khác: quên trạng thái xem của phòng cũ.
  useEffect(() => {
    setSpectate({ freeCam: false, watch: false, everAlive: false });
  }, [room]);

  useEffect(() => {
    const locked = () => !!document.pointerLockElement;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat || !watching(room) || getKillcam()) return;
      if (e.code === "KeyQ" || e.code === "KeyE") {
        cycleSpectate(room, e.code === "KeyE" ? 1 : -1);
        setSpectate({ freeCam: false });
      } else if (e.code === "Space") {
        e.preventDefault();
        setSpectate({ freeCam: !getSpectate().freeCam });
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!locked() || !watching(room) || getKillcam()) return;
      // Chuột trái: Shooter đã chuyển sang người kế tiếp; ở đây chỉ thoát camera tự do. Chuột phải: người trước.
      if (e.button === 2) cycleSpectate(room, -1);
      if (e.button === 0 || e.button === 2) setSpectate({ freeCam: false });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [room]);

  if (!can || kc) return null;
  return (
    <div className="b-spectate">
      {sp.freeCam ? (
        <div className="sp-who">
          <b>Camera tự do</b>
        </div>
      ) : target ? (
        <div className="sp-who">
          <span className="sp-kicker">{sp.everAlive ? "Đang xem" : "Đang xem trận"}</span>
          <b>
            <RankBadge rank={target.rank} size={18} />
            {target.name}
          </b>
          <span className="sp-hp">
            <i style={{ width: `${Math.round((target.hp / target.maxHp) * 100)}%` }} />
          </span>
          <span className="sp-gun">
            {target.weapon}
            {target.armor ? ` · giáp ${target.armor}` : ""}
            {target.helmet ? ` · mũ ${target.helmet}` : ""}
          </span>
        </div>
      ) : (
        <div className="sp-who">
          <b>Không còn ai để xem</b>
        </div>
      )}
      <div className="sp-keys">
        <kbd>Q</kbd>/<kbd>E</kbd> hoặc chuột trái/phải: đổi người{squad ? " (đội mình)" : ""} · <kbd>Space</kbd> {sp.freeCam ? "thôi bay" : "camera tự do"}
        {sp.freeCam && (
          <>
            {" "}
            · <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> bay, <kbd>Shift</kbd> nhanh
          </>
        )}
        {sp.watch && (
          <>
            {" "}
            ·{" "}
            <button className="sp-show" onClick={() => setSpectate({ watch: false })}>
              Hiện bảng kết quả
            </button>
          </>
        )}
      </div>
    </div>
  );
}
