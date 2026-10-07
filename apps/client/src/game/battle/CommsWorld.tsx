import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Camera } from "three";
import type { World } from "@tentides/content";
import { Messages, PING_WHEEL, type PingMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { lookLock } from "../input.ts";
import { localPosition } from "../shared.ts";
import { PING_HOLD_MS, enemyAlong, lootAlong, markerPool, pingText, pingWheelOpen, pings, setPingWheel, updatePings, wheelSlice } from "./comms.ts";
import { menuOpen, seat } from "./runtime.ts";
import { lastOrder, ORDER_LABEL } from "./SquadHud.tsx";
import { physicsProbe } from "./surface.ts";

// Phần trong cảnh 3D của liên lạc trong đội: bấm chuột giữa thì dò tia từ camera qua tâm màn hình, đánh dấu theo
// ngữ cảnh (trúng địch: "Phát hiện địch!", trúng đồ dưới đất: "Ở đây có …!", chỗ trống: "Di chuyển tới đây!"; bấm đúp
// là nguy hiểm); giữ chuột giữa thì mở vòng chọn (tấn công, phòng thủ, đang tới, cần giáp, thấy địch, cẩn thận), thả ra
// để đánh dấu ô đang chọn ở chỗ đã nhìn lúc bấm. Mỗi khung hình chiếu các dấu (cùng lệnh đội đang ra) lên màn hình: ô
// dấu ghim vào chỗ trong thế giới, ra ngoài khung nhìn thì nép vào mép màn hình kèm mũi tên.

/** Bấm đúp trong khoảng này (ms) là dấu nguy hiểm; bấm đơn thì chờ hết khoảng này mới gửi. */
const DOUBLE_MS = 260;
const PING_RANGE = 400;
/** Chuột phải đi chừng này điểm ảnh khỏi tâm vòng chọn mới tính là chọn ô. */
const WHEEL_DEAD = 24;
/** Mép màn hình (toạ độ chuẩn −1…1) mà dấu nép vào khi ở ngoài khung nhìn. */
const EDGE_X = 0.93;
const EDGE_Y = 0.86;

const tmp = new Vector3();
const dir = new Vector3();
/** Ô nào đang hiện dấu nào (số hiệu dấu; 0 là trống), số mét đang hiện: chỉ ghi DOM khi đổi. */
const shown: number[] = [];
const shownDist: number[] = [];

/** Giao ô thứ `n` cho dấu `key`; true nếu ô vừa đổi sang dấu khác (để gán lại lớp, chữ). */
function claim(n: number, key: number): boolean {
  if (shown[n] === key) return false;
  shown[n] = key;
  shownDist[n] = -1;
  return true;
}

/** Đặt ô dấu lên màn hình ở chỗ chiếu của (x, y, z); ngoài khung nhìn thì nép vào mép, mũi tên chỉ hướng. */
function place(el: HTMLDivElement, n: number, cam: Camera, size: { width: number; height: number }, x: number, y: number, z: number) {
  // Toạ độ camera: z > 0 là ở sau lưng (lật lại rồi nép vào mép).
  tmp.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
  const behind = tmp.z > 0;
  tmp.applyMatrix4(cam.projectionMatrix);
  let nx = behind ? -tmp.x : tmp.x;
  let ny = behind ? -tmp.y : tmp.y;
  const over = Math.max(Math.abs(nx) / EDGE_X, Math.abs(ny) / EDGE_Y);
  const edge = behind || over > 1;
  if (edge) {
    const k = 1 / Math.max(over, 1e-3);
    nx *= k;
    ny *= k;
    (el.children[0] as HTMLElement).style.transform = `rotate(${Math.atan2(-ny, nx).toFixed(2)}rad)`;
  }
  el.classList.toggle("edge", edge);
  el.style.transform = `translate3d(${(((nx + 1) / 2) * size.width).toFixed(1)}px, ${(((1 - ny) / 2) * size.height).toFixed(1)}px, 0)`;
  el.style.display = "";
  const d = Math.round(Math.hypot(x - localPosition.x, y - localPosition.y, z - localPosition.z));
  if (d !== shownDist[n]) {
    shownDist[n] = d;
    el.children[3]!.textContent = `${d} m`;
  }
}

/** Cập nhật ô đang chọn trên vòng dấu (chỉ khi vòng đang mở; kho tự bỏ qua nếu không đổi). */
function pingWheelPick(dx: number, dy: number) {
  if (!pingWheelOpen()) return;
  setPingWheel(true, wheelSlice(dx, dy, PING_WHEEL.length, WHEEL_DEAD));
}

export function CommsWorld({ room, world }: { room: IslandRoom; world: World }) {
  const camera = useThree((s) => s.camera);

  // Chuột giữa: bấm nhanh là dấu theo ngữ cảnh (bấm đúp: nguy hiểm), giữ là vòng chọn.
  useEffect(() => {
    let pending: (PingMessage & { timer: number }) | null = null;
    /** Đang giữ chuột giữa: dấu theo ngữ cảnh đã dò lúc bấm, hẹn giờ mở vòng chọn, vòng đã mở chưa. */
    let hold: { m: PingMessage; timer: number; wheel: boolean } | null = null;
    const flush = () => {
      if (!pending) return;
      const { timer: _t, ...m } = pending;
      pending = null;
      room.send(Messages.ping, m);
    };
    /** Dò tia từ camera qua tâm màn hình: dấu theo ngữ cảnh (địch, đồ dưới đất, chỗ trống). */
    const probe = (me: string): PingMessage => {
      camera.getWorldDirection(dir);
      // Ngồi xe tăng: bắt đầu tia ra khỏi thân xe (camera ở sau xe).
      const skip = seat.id ? 6 : 0.3;
      const ox = camera.position.x + dir.x * skip;
      const oy = camera.position.y + dir.y * skip;
      const oz = camera.position.z + dir.z * skip;
      const hit = physicsProbe.cast?.(ox, oy, oz, dir.x, dir.y, dir.z, PING_RANGE) ?? null;
      let t = hit ? hit.t : 0;
      if (!hit) {
        // Không trúng gì (nhìn lên trời, quá xa): lấy điểm trên mặt đất dọc tia, không thì 150 m phía trước.
        t = 150;
        for (let s = 2; s < PING_RANGE; s += 2)
          if (oy + dir.y * s < world.heightAt(ox + dir.x * s, oz + dir.z * s)) {
            t = s;
            break;
          }
      }
      const target = enemyAlong(room, me, ox, oy, oz, dir.x, dir.y, dir.z, t + 1.5);
      if (target) {
        const p = room.state.players.get(target);
        if (p) return { kind: "enemy", target, x: p.x, y: p.y, z: p.z };
      }
      const item = lootAlong(room, ox, oy, oz, dir.x, dir.y, dir.z, t + 1.5);
      const g = item ? room.state.groundItems.get(item) : undefined;
      if (g) return { kind: "loot", item, x: g.x, y: g.y, z: g.z };
      return { kind: "spot", x: ox + dir.x * t, y: oy + dir.y * t, z: oz + dir.z * t };
    };
    const closeWheel = () => {
      if (hold?.wheel) {
        lookLock.active = false;
        setPingWheel(false, -1);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (!document.pointerLockElement || menuOpen() || hold) return;
      const phase = room.state.phase;
      if (phase !== "prep" && phase !== "battle") return;
      const me = myId(room);
      if (!room.state.players.get(me)?.alive) return;
      // Bấm lần hai ngay sau lần đầu: đổi dấu vừa chọn thành "nguy hiểm".
      if (pending) {
        clearTimeout(pending.timer);
        pending.kind = "danger";
        pending.target = undefined;
        pending.item = undefined;
        flush();
        return;
      }
      const m = probe(me);
      hold = {
        m,
        wheel: false,
        timer: window.setTimeout(() => {
          // Vòng khẩu lệnh bộ đàm đang mở (cũng khoá hướng nhìn) thì thôi.
          if (!hold || lookLock.active) return;
          hold.wheel = true;
          lookLock.active = true;
          lookLock.dx = 0;
          lookLock.dy = 0;
          setPingWheel(true, -1);
        }, PING_HOLD_MS),
      };
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 1 || !hold) return;
      const h = hold;
      clearTimeout(h.timer);
      if (h.wheel) {
        // Thả trên vòng chọn: đánh dấu ô đang chọn ở chỗ đã nhìn lúc bấm (giữa vùng chết thì thôi).
        const pick = wheelSlice(lookLock.dx, lookLock.dy, PING_WHEEL.length, WHEEL_DEAD);
        closeWheel();
        hold = null;
        if (pick >= 0) room.send(Messages.ping, { kind: PING_WHEEL[pick]!, x: h.m.x, y: h.m.y, z: h.m.z } satisfies PingMessage);
        return;
      }
      hold = null;
      pending = { ...h.m, timer: window.setTimeout(flush, DOUBLE_MS) };
    };
    // Chặn cuộn tự động của trình duyệt khi bấm chuột giữa.
    const onAux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onBlur = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      closeWheel();
      hold = null;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("auxclick", onAux);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("auxclick", onAux);
      window.removeEventListener("blur", onBlur);
      if (pending) clearTimeout(pending.timer);
      onBlur();
    };
  }, [room, camera, world]);

  useFrame(({ camera: cam, size }) => {
    // Vòng chọn dấu đang mở: ô theo chuột đã đi (giữ chuột trong vòng để đổi ô cho nhanh).
    if (lookLock.active) {
      const r = Math.hypot(lookLock.dx, lookLock.dy);
      if (r > 120) {
        lookLock.dx *= 120 / r;
        lookLock.dy *= 120 / r;
      }
    }
    pingWheelPick(lookLock.dx, lookLock.dy);
    const els = markerPool.els;
    if (!els.length) return;
    const now = performance.now();
    updatePings(now);
    let n = 0;
    for (const p of pings) {
      if (n >= els.length) break;
      if (claim(n, p.key)) {
        els[n]!.className = `cm-mark ${p.kind}${p.mine ? " mine" : ""}`;
        els[n]!.children[2]!.textContent = p.mine ? pingText(p.kind, p.item) : `${pingText(p.kind, p.item)} · ${p.name}`;
      }
      place(els[n]!, n, cam, size, p.x, p.y + (p.kind === "enemy" || p.kind === "spotted" ? 2.3 : 0.6), p.z);
      n++;
    }
    // Lệnh đội đang ra (đội trưởng, chế độ Đồng đội): tới điểm / giữ chốt ở chỗ đã chỉ, lên xe tăng thì ghim vào xe.
    const phase = room.state.phase;
    if (lastOrder.at > 0 && lastOrder.kind !== "follow" && n < els.length && room.state.battleMode === "squad" && (phase === "prep" || phase === "battle")) {
      const board = lastOrder.kind === "board";
      const v = board ? room.state.vehicles.get(lastOrder.vid) : undefined;
      if (board && (!v || v.hp <= 0 || v.driver || now - lastOrder.at > 30000)) lastOrder.kind = "follow";
      else {
        const x = v ? v.x : lastOrder.x;
        const z = v ? v.z : lastOrder.z;
        const y = v ? v.y + 3.2 : world.heightAt(x, z) + 1.2;
        if (claim(n, -lastOrder.at)) {
          els[n]!.className = "cm-mark order";
          els[n]!.children[2]!.textContent = ORDER_LABEL[lastOrder.kind] ?? "";
        }
        place(els[n]!, n, cam, size, x, y, z);
        n++;
      }
    }
    for (let i = n; i < els.length; i++) {
      if (shown[i] !== 0) {
        shown[i] = 0;
        els[i]!.style.display = "none";
      }
    }
  });
  return null;
}
