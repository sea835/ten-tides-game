import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { Vector3, type Group } from "three";
import { ANCHORS, ANCHOR_TRIGGER_RADIUS, CAMP, CAMP_RADIUS, DIG_RADIUS, TREASURE_SITES, heightAt, inTallGrass, zoneAt } from "@tentides/content";
import { MAX_RUN_SPEED, Messages, type CorrectMessage, type MoveMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { Character } from "./Character.tsx";
import { getHud, setHud } from "./hudStore.ts";
import { isTyping, keys, look } from "./input.ts";
import { localMotion, localPosition } from "./shared.ts";
import { isBusy, useRoomSnapshot } from "./useRoomSnapshot.ts";

const WALK_SPEED = 8;
const GRAVITY = 25;
const JUMP_SPEED = 8;
/** Nước sâu hơn mức này thì chưa lội qua được (bơi sẽ làm sau, gắn với sức bền). */
const MAX_WADE_DEPTH = 1.2;
const CAMERA_DISTANCE = 7;
/** Sức bền tốn mỗi giây khi chạy: 22 − 2,5 × Thể lực (Thể lực 1 chạy được khoảng 5 giây, Thể lực 5 khoảng 10 giây). */
const SPRINT_DRAIN_BASE = 22;
const SPRINT_DRAIN_PER_STRENGTH = 2.5;
const SPRINT_REGEN = 12;
/** Ngồi nghỉ thì hồi sức bền nhanh gấp chừng này lần. */
const SIT_REGEN_BONUS = 2;
/** Tâm camera (tính từ chân) khi đứng và khi ngồi. */
const CAM_HEIGHT_STAND = 1.6;
const CAM_HEIGHT_SIT = 1.0;
const SPRINT_RECOVER_AT = 25;
const OVERWEIGHT_SPEED = 0.8;
const CAMERA_MIN_DISTANCE = 1.2;
const SEND_INTERVAL = 1 / 15;
const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.4;
const FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

type CharacterController = ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]>;

export function LocalPlayer({ room }: { room: IslandRoom }) {
  const me = room.state.players.get(myId(room))!;
  const spawn = useMemo(() => new Vector3(me.x, me.y, me.z), [me]);

  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const avatar = useRef<Group>(null);
  const { world, rapier } = useRapier();

  // Tạo và huỷ trong cùng một effect: StrictMode chạy effect hai lần, nếu tạo bằng useMemo
  // thì lần dọn dẹp đầu sẽ giải phóng controller mà lần chạy sau vẫn dùng.
  const controllerRef = useRef<CharacterController | null>(null);
  useEffect(() => {
    const c = world.createCharacterController(0.05);
    c.enableAutostep(0.5, 0.2, false);
    c.enableSnapToGround(0.4);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controllerRef.current = c;
    return () => {
      controllerRef.current = null;
      world.removeCharacterController(c);
    };
  }, [world]);

  const sim = useRef({
    vy: 0,
    grounded: false,
    facing: me.rotY,
    sendTimer: 0,
    lastSent: "",
    started: false,
    energy: 100,
    exhausted: false,
    sitting: false,
    camHeight: CAM_HEIGHT_STAND,
  });
  const camTarget = useMemo(() => new Vector3(), []);
  const camPos = useMemo(() => new Vector3(), []);
  const camDir = useMemo(() => new Vector3(), []);

  // Server từ chối vị trí thì dịch về đúng chỗ server giữ.
  useEffect(
    () =>
      room.onMessage(Messages.correct, (at: CorrectMessage) => {
        body.current?.setTranslation({ x: at.x, y: at.y + FEET_OFFSET, z: at.z }, true);
        sim.current.vy = 0;
      }),
    [room],
  );

  // Nhấn E khi đứng cạnh một điểm sự kiện để mở thẻ. Server kiểm tra lại khoảng cách.
  // Nhấn C để ngồi xuống hoặc đứng dậy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      if (e.code === "KeyC") {
        sim.current.sitting = !sim.current.sitting;
        return;
      }
      if (e.code !== "KeyE") return;
      const { nearAnchor, atDigSite } = getHud();
      if (atDigSite) room.send(Messages.dig);
      else if (nearAnchor) room.send(Messages.trigger, { anchorId: nearAnchor });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room]);

  useFrame((state, rawDt) => {
    const rb = body.current;
    const col = collider.current;
    const controller = controllerRef.current;
    if (!rb || !col || !controller) return;
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;
    const firstFrame = !s.started;
    if (firstFrame) {
      // Khung hình đầu tiên: đặt camera sau lưng nhân vật, nhìn cùng hướng với nhân vật.
      s.started = true;
      look.yaw = me.rotY + Math.PI;
    }
    // Tạm dừng thì đứng yên; đang trong sự kiện thì đứng yên tại chỗ, người khác vẫn đi tiếp.
    const sheet = room.state.players.get(myId(room));
    const frozen = room.state.paused || isBusy(room.state, myId(room));

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const inputScale = frozen ? 0 : 1;
    // Bấm đi hoặc nhảy khi đang ngồi thì đứng dậy luôn.
    if (s.sitting && !frozen && (forward !== 0 || strafe !== 0 || keys.has("Space"))) s.sitting = false;

    // Chạy nhanh tốn sức bền; Thể lực càng cao càng tốn ít. Cạn sức thì phải hồi lại một đoạn mới chạy tiếp.
    // Thanh hồi tối đa tới mức sức bền trong ngày (các sự kiện làm mệt sẽ kéo mức này xuống).
    const wantsRun = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && (forward !== 0 || strafe !== 0) && !frozen;
    const running = wantsRun && !s.exhausted && s.energy > 0;
    const strength = sheet?.stats.get("strength") ?? 3;
    if (running) {
      s.energy = Math.max(0, s.energy - (SPRINT_DRAIN_BASE - SPRINT_DRAIN_PER_STRENGTH * strength) * dt);
      if (s.energy === 0) s.exhausted = true;
    } else {
      s.energy += SPRINT_REGEN * (s.sitting ? SIT_REGEN_BONUS : 1) * dt;
      if (s.exhausted && s.energy >= SPRINT_RECOVER_AT) s.exhausted = false;
    }
    s.energy = Math.min(s.energy, sheet?.stamina ?? 100);
    // Quá tải thì đi chậm hơn.
    const speed = (running ? MAX_RUN_SPEED : WALK_SPEED) * (sheet?.overweight ? OVERWEIGHT_SPEED : 1);

    // Hướng "tới" là hướng camera đang nhìn, chiếu xuống mặt phẳng ngang.
    let mx = -Math.sin(look.yaw) * forward + Math.cos(look.yaw) * strafe;
    let mz = -Math.cos(look.yaw) * forward - Math.sin(look.yaw) * strafe;
    mx *= inputScale;
    mz *= inputScale;
    const len = Math.hypot(mx, mz);
    const moving = len > 0;
    if (moving) {
      mx = (mx / len) * speed * dt;
      mz = (mz / len) * speed * dt;
      s.facing = Math.atan2(mx, mz);
    }

    const pos = rb.translation();
    const depth = -heightAt(pos.x + mx, pos.z + mz);
    const blockedByWater = depth > MAX_WADE_DEPTH && depth > -heightAt(pos.x, pos.z);
    // Bị trói thì chỉ quanh quẩn trong trại (server cũng chặn).
    const tied = room.state.players.get(myId(room))?.tied ?? false;
    const campDist = (x: number, z: number) => Math.hypot(x - CAMP.x, z - CAMP.z);
    const leavingCamp = tied && campDist(pos.x + mx, pos.z + mz) > CAMP_RADIUS - 0.5 && campDist(pos.x + mx, pos.z + mz) > campDist(pos.x, pos.z);
    if (blockedByWater || leavingCamp) {
      mx = 0;
      mz = 0;
    }

    if (s.grounded && !frozen && keys.has("Space")) s.vy = JUMP_SPEED;
    s.vy -= GRAVITY * dt;

    controller.computeColliderMovement(col, { x: mx, y: s.vy * dt, z: mz });
    const delta = controller.computedMovement();
    s.grounded = controller.computedGrounded();
    if (s.grounded && s.vy < 0) s.vy = 0;

    const next = { x: pos.x + delta.x, y: pos.y + delta.y, z: pos.z + delta.z };
    if (next.y < heightAt(next.x, next.z) - 5) {
      // Lỡ lọt khỏi địa hình thì đưa về điểm xuất phát.
      next.x = spawn.x;
      next.y = spawn.y;
      next.z = spawn.z;
      s.vy = 0;
    }
    rb.setNextKinematicTranslation(next);

    if (avatar.current) {
      const current = avatar.current.rotation.y;
      const diff = Math.atan2(Math.sin(s.facing - current), Math.cos(s.facing - current));
      avatar.current.rotation.y = current + diff * Math.min(1, dt * 12);
    }

    // Camera góc nhìn thứ ba, bám mượt theo nhân vật.
    const feetY = next.y - FEET_OFFSET;
    s.camHeight += ((s.sitting ? CAM_HEIGHT_SIT : CAM_HEIGHT_STAND) - s.camHeight) * Math.min(1, dt * 6);
    camTarget.set(next.x, feetY + s.camHeight, next.z);
    const horizontal = Math.cos(look.pitch) * CAMERA_DISTANCE;
    camPos.set(
      camTarget.x + Math.sin(look.yaw) * horizontal,
      camTarget.y + Math.sin(look.pitch) * CAMERA_DISTANCE,
      camTarget.z + Math.cos(look.yaw) * horizontal,
    );
    // Có vật cản (thân cây, vách hang, sườn đồi) giữa nhân vật và camera thì kéo camera lại gần.
    camDir.subVectors(camPos, camTarget).normalize();
    const hit = world.castRay(new rapier.Ray(camTarget, camDir), CAMERA_DISTANCE, true, undefined, undefined, col);
    const blocked = hit !== null;
    if (hit) camPos.copy(camTarget).addScaledVector(camDir, Math.max(CAMERA_MIN_DISTANCE, hit.timeOfImpact - 0.3));
    const minCamY = Math.max(heightAt(camPos.x, camPos.z), 0) + 0.5;
    if (camPos.y < minCamY) camPos.y = minCamY;
    // Khung hình đầu đặt thẳng vào chỗ, không để camera bay từ giữa đảo tới.
    if (blocked || firstFrame) state.camera.position.copy(camPos);
    else state.camera.position.lerp(camPos, Math.min(1, dt * 10));
    state.camera.lookAt(camTarget);

    localPosition.set(next.x, feetY, next.z);
    localMotion.moving = moving;
    localMotion.running = moving && running;
    localMotion.sitting = s.sitting;

    setHud({
      zone: zoneAt(next.x, next.z),
      deepWater: blockedByWater,
      nearAnchor: frozen ? null : nearestOpenAnchor(room, next.x, next.z),
      sprint: Math.round(s.energy),
      atDigSite: !frozen && atDigSite(room, next.x, next.z),
      sitting: s.sitting,
      hidden: s.sitting && inTallGrass(next.x, next.z),
    });

    s.sendTimer += dt;
    if (s.sendTimer >= SEND_INTERVAL) {
      s.sendTimer = 0;
      const msg: MoveMessage = { x: next.x, y: feetY, z: next.z, rotY: s.facing, moving, sitting: s.sitting };
      const key = `${msg.x.toFixed(2)},${msg.y.toFixed(2)},${msg.z.toFixed(2)},${msg.rotY.toFixed(2)},${moving},${s.sitting}`;
      if (key !== s.lastSent) {
        s.lastSent = key;
        room.send(Messages.move, msg);
      }
    }
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[spawn.x, spawn.y + FEET_OFFSET, spawn.z]}>
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      <group position-y={-FEET_OFFSET}>
        <Carrier room={room}>{(carrying) => <Character ref={avatar} color={me.color} carrying={carrying} motion={readLocalMotion} />}</Carrier>
      </group>
    </RigidBody>
  );
}

const readLocalMotion = () => localMotion;

function nearestOpenAnchor(room: IslandRoom, x: number, z: number): string | null {
  if (room.state.phase !== "explore") return null;
  let best: string | null = null;
  let bestDist = ANCHOR_TRIGGER_RADIUS;
  for (const [id, placed] of room.state.anchors) {
    if (placed.status !== "open") continue;
    const anchor = ANCHORS.find((a) => a.id === id);
    if (!anchor) continue;
    const d = Math.hypot(anchor.x - x, anchor.z - z);
    if (d <= bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

function atDigSite(room: IslandRoom, x: number, z: number): boolean {
  const state = room.state;
  if (state.phase !== "explore" || !state.treasureSite || state.treasureDug) return false;
  const site = TREASURE_SITES.find((t) => t.id === state.treasureSite);
  return !!site && Math.hypot(site.x - x, site.z - z) <= DIG_RADIUS;
}

/** Vẽ lại nhân vật khi mình bắt đầu hay thôi vác rương. */
function Carrier({ room, children }: { room: IslandRoom; children: (carrying: boolean) => ReactNode }) {
  const carrying = useRoomSnapshot(room, (s) => s.treasureCarrier === myId(room) && !s.treasureSafe);
  return <>{children(carrying)}</>;
}
