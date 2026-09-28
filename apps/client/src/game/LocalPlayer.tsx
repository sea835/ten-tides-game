import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { Vector3, type Group } from "three";
import {
  ANCHORS,
  ANCHOR_TRIGGER_RADIUS,
  ASSASSINATE_RADIUS,
  CAMP_RADIUS,
  CLIMB_REACH,
  DIG_RADIUS,
  PICKUP_RADIUS,
  TREASURE_SITES,
  WATER_LEVEL,
  content,
  worldCatalog,
  type World,
} from "@tentides/content";
import { INTERACT_RADIUS, MAX_RUN_SPEED, Messages, type CorrectMessage, type KnockMessage, type MoveMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { Character, type Motion } from "./Character.tsx";
import { getHud, setHud, type NearTarget } from "./hudStore.ts";
import { isTyping, keys, look } from "./input.ts";
import { getHands } from "./handsStore.ts";
import { getPrivate } from "./privateStore.ts";
import { debugCam, knock, localAim, localEnv, localMotion, localPosition, shake } from "./shared.ts";
import { climbTop, climbTrees, trunkAt, type ClimbTree } from "./Trees.tsx";
import { isBusy, useRoomSnapshot } from "./useRoomSnapshot.ts";

const WALK_SPEED = 8;
const GRAVITY = 25;
const JUMP_SPEED = 8;
/** Nước sâu hơn mức này thì phải bơi; nông hơn mức kia thì lại chạm chân xuống đáy mà lội. */
const SWIM_ENTER_DEPTH = 1.35;
const SWIM_EXIT_DEPTH = 1.1;
/** Khi bơi trên mặt nước, chân ở dưới mặt nước chừng này (đầu và vai nhô lên). */
const SWIM_FLOAT = 1.3;
const SWIM_SPEED = 4.2;
const SWIM_SPRINT_SPEED = 6.3;
const DIVE_SPEED = 3.2;
const ASCEND_SPEED = 3.4;
/** Đầu cách chân chừng này: đầu dưới mặt nước là đang lặn (server tính hơi thở cùng mốc này). */
const HEAD_HEIGHT = 1.5;
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
/** Leo cây: ôm cách tâm thân cây chừng này, trèo lên/tuột xuống nhanh chừng này, A/D vòng quanh thân. */
const CLIMB_HUG = 0.72;
const CLIMB_SPEED = 2.2;
const CLIMB_SPRINT_SPEED = 3.4;
const CLIMB_TURN = 2.2;
/** Vừa đánh hay ném thì quay mặt theo hướng camera chừng này giây. */
const AIM_FACE_MS = 450;

type CharacterController = ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]>;

export function LocalPlayer({ room, world }: { room: IslandRoom; world: World }) {
  const me = room.state.players.get(myId(room))!;
  const spawn = useMemo(() => new Vector3(me.x, me.y, me.z), [me]);

  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const avatar = useRef<Group>(null);
  const { world: physics, rapier } = useRapier();

  // Tạo và huỷ trong cùng một effect: StrictMode chạy effect hai lần, nếu tạo bằng useMemo
  // thì lần dọn dẹp đầu sẽ giải phóng controller mà lần chạy sau vẫn dùng.
  const controllerRef = useRef<CharacterController | null>(null);
  useEffect(() => {
    const c = physics.createCharacterController(0.05);
    c.enableAutostep(0.5, 0.2, false);
    c.enableSnapToGround(0.4);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controllerRef.current = c;
    return () => {
      controllerRef.current = null;
      physics.removeCharacterController(c);
    };
  }, [physics]);

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
    swimming: false,
    camHeight: CAM_HEIGHT_STAND,
    /** Đang leo cây nào (server đã đồng ý), cao bao nhiêu trên gốc, đứng ở góc nào quanh thân. */
    climb: null as { tree: ClimbTree; h: number; angle: number } | null,
    wobble: 0,
    /** Vừa bấm Space để nhảy khỏi cây (chờ server đồng ý thôi leo). */
    leap: false,
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
  // Bị đánh trúng: bật lùi theo hướng server báo, nảy lên một chút.
  useEffect(
    () =>
      room.onMessage(Messages.knock, (k: KnockMessage) => {
        knock.vx += k.dx * k.force;
        knock.vz += k.dz * k.force;
        if (sim.current.grounded) sim.current.vy = Math.max(sim.current.vy, k.force * 0.5);
        shake.amount = Math.min(0.8, shake.amount + 0.3);
      }),
    [room],
  );

  // Nhấn E khi đứng cạnh một điểm sự kiện để mở thẻ. Server kiểm tra lại khoảng cách.
  // Nhấn C để ngồi xuống hoặc đứng dậy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      if (e.code === "KeyC") {
        // Đang bơi thì C là giữ để lặn, không phải ngồi.
        if (!sim.current.swimming) sim.current.sitting = !sim.current.sitting;
        return;
      }
      // Đang leo thì E là buông tay tụt xuống, Space là nhún người nhảy ra khỏi cây.
      if (sim.current.climb && (e.code === "KeyE" || e.code === "Space")) {
        sim.current.leap = e.code === "Space";
        room.send(Messages.climb, { treeId: "" });
        return;
      }
      if (e.code !== "KeyE") return;
      const { nearAnchor, atDigSite, nearTarget } = getHud();
      if (atDigSite) room.send(Messages.dig);
      else if (nearAnchor) room.send(Messages.trigger, { anchorId: nearAnchor });
      else if (nearTarget?.kind === "item") room.send(Messages.pickup, { id: nearTarget.id });
      else if (nearTarget?.kind === "tree") room.send(Messages.climb, { treeId: nearTarget.id });
      else if (nearTarget?.kind === "camp") room.send(Messages.packCamp);
      else if (nearTarget?.kind === "campfire") room.send(Messages.campfire);
      else if (nearTarget) room.send(Messages.interact, { targetId: nearTarget.id });
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
    const stunned = (sheet?.stun ?? 0) > 0;
    const frozen = room.state.paused || isBusy(room.state, myId(room)) || stunned;
    const dizzy = sheet?.dizzy ?? 0;

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const inputScale = frozen ? 0 : 1;
    // Bấm đi hoặc nhảy khi đang ngồi thì đứng dậy luôn.
    if (s.sitting && !frozen && (forward !== 0 || strafe !== 0 || keys.has("Space"))) s.sitting = false;

    const pos = rb.translation();
    const feetNow = pos.y - FEET_OFFSET;
    const waterDepth = WATER_LEVEL - world.heightAt(pos.x, pos.z);
    // Vào nước sâu thì bơi; về chỗ nông chạm được đáy thì lội. Hai ngưỡng khác nhau để khỏi chập chờn ở mép.
    const wasSwimming = s.swimming;
    if (!s.swimming && waterDepth > SWIM_ENTER_DEPTH && feetNow < WATER_LEVEL - 0.5) s.swimming = true;
    else if (s.swimming && waterDepth < SWIM_EXIT_DEPTH) s.swimming = false;
    if (s.swimming !== wasSwimming) {
      // Bơi thì không bám xuống đáy (không thì chân bị hút xuống đáy biển).
      if (s.swimming) controller.disableSnapToGround();
      else controller.enableSnapToGround(0.4);
      s.sitting = false;
    }
    const breath = sheet?.breath ?? 100;

    // Chạy (hoặc bơi nhanh) tốn sức bền; Thể lực càng cao càng tốn ít. Cạn sức thì phải hồi lại một đoạn mới chạy tiếp.
    // Thanh hồi tối đa tới mức sức bền trong ngày (các sự kiện làm mệt sẽ kéo mức này xuống).
    const wantsRun = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && (forward !== 0 || strafe !== 0) && !frozen;
    const running = wantsRun && !s.exhausted && s.energy > 0;
    const strength = sheet?.stats.get("strength") ?? 3;
    if (running) {
      s.energy = Math.max(0, s.energy - (SPRINT_DRAIN_BASE - SPRINT_DRAIN_PER_STRENGTH * strength) * dt);
      if (s.energy === 0) s.exhausted = true;
    } else {
      s.energy += SPRINT_REGEN * (s.sitting ? SIT_REGEN_BONUS : 1) * (s.swimming ? 0.5 : 1) * dt;
      if (s.exhausted && s.energy >= SPRINT_RECOVER_AT) s.exhausted = false;
    }
    s.energy = Math.min(s.energy, sheet?.stamina ?? 100);
    // Quá tải thì đi (và bơi) chậm hơn.
    const baseSpeed = s.swimming ? (running ? SWIM_SPRINT_SPEED : SWIM_SPEED) : running ? MAX_RUN_SPEED : WALK_SPEED;
    const speed = baseSpeed * (sheet?.overweight ? OVERWEIGHT_SPEED : 1);

    // Hướng "tới" là hướng camera đang nhìn, chiếu xuống mặt phẳng ngang.
    // Chóng mặt thì đi loạng choạng: hướng đi bị lệch qua lệch lại.
    s.wobble += dt;
    const reel = dizzy > 0 ? Math.sin(s.wobble * 2.3) * 0.9 + Math.sin(s.wobble * 5.1) * 0.35 : 0;
    const heading = look.yaw + reel;
    let mx = -Math.sin(heading) * forward + Math.cos(heading) * strafe;
    let mz = -Math.cos(heading) * forward - Math.sin(heading) * strafe;
    mx *= inputScale;
    mz *= inputScale;
    const len = Math.hypot(mx, mz);
    const moving = len > 0;
    if (moving) {
      mx = (mx / len) * speed * dt;
      mz = (mz / len) * speed * dt;
      s.facing = Math.atan2(mx, mz);
    }

    // Bị trói thì chỉ quanh quẩn trong trại (server cũng chặn).
    const tied = room.state.players.get(myId(room))?.tied ?? false;
    const campDist = (x: number, z: number) => Math.hypot(x - room.state.campX, z - room.state.campZ);
    const leavingCamp = tied && campDist(pos.x + mx, pos.z + mz) > CAMP_RADIUS - 0.5 && campDist(pos.x + mx, pos.z + mz) > campDist(pos.x, pos.z);
    if (leavingCamp) {
      mx = 0;
      mz = 0;
    }

    // Leo cây: server đồng ý thì bám vào thân, không còn trọng lực hay va chạm; server báo thôi leo
    // (tự buông, nhảy ra, hay cây bị đốn) thì rơi xuống như thường.
    const climbingId = sheet?.alive ? (sheet?.climbing ?? "") : "";
    if (climbingId && s.climb?.tree.id !== climbingId) {
      const tree = climbTrees(room, world).find((t) => t.id === climbingId);
      if (tree) s.climb = { tree, h: Math.max(0.2, feetNow - tree.y), angle: Math.atan2(pos.x - tree.x, pos.z - tree.z) };
    } else if (!climbingId && s.climb) {
      // Thôi leo: đẩy nhẹ ra khỏi thân cây cho khỏi kẹt vào thân; nhảy ra thì bật xa và nảy lên.
      const push = s.leap ? 5 : 2.5;
      knock.vx += Math.sin(s.climb.angle) * push;
      knock.vz += Math.cos(s.climb.angle) * push;
      s.vy = s.leap ? JUMP_SPEED * 0.6 : 0;
      s.climb = null;
      s.leap = false;
    }

    let next: { x: number; y: number; z: number };
    let climbMoving = false;
    if (s.climb) {
      const c = s.climb;
      const top = climbTop(c.tree);
      const climbSpeed = (running ? CLIMB_SPRINT_SPEED : CLIMB_SPEED) * inputScale;
      c.h = Math.min(top, c.h + forward * climbSpeed * dt);
      c.angle += strafe * CLIMB_TURN * dt * inputScale;
      climbMoving = !frozen && (forward !== 0 || strafe !== 0);
      if (!frozen && c.h <= 0 && forward < 0) {
        // Tụt tới gốc rồi mà vẫn bấm S: xuống đất.
        c.h = 0;
        room.send(Messages.climb, { treeId: "" });
      }
      c.h = Math.max(0, c.h);
      const center = trunkAt(c.tree, c.h);
      next = { x: center.x + Math.sin(c.angle) * CLIMB_HUG, y: c.tree.y + c.h + FEET_OFFSET, z: center.z + Math.cos(c.angle) * CLIMB_HUG };
      s.facing = c.angle + Math.PI;
      s.grounded = false;
      s.sitting = false;
    } else {
      if (s.swimming) {
        // Giữ C (hoặc Ctrl) để lặn, Space để ngoi; thả tay thì nổi dần lên mặt nước. Hết hơi thì bị đẩy lên.
        const surface = WATER_LEVEL - SWIM_FLOAT;
        const diving = !frozen && breath > 0 && (keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight"));
        const ascending = !frozen && keys.has("Space");
        let target: number;
        if (diving) target = -DIVE_SPEED;
        else if (ascending || breath === 0) target = ASCEND_SPEED;
        else target = feetNow < surface - 0.05 ? 1.6 : (surface - feetNow) * 4;
        s.vy += (target - s.vy) * Math.min(1, dt * 6);
        // Không nhô khỏi mặt nước khi đang bơi (trừ khi tới chỗ nông thì lội lên bờ).
        if (feetNow + s.vy * dt > surface + 0.05 && s.vy > 0) s.vy = Math.max(0, (surface + 0.05 - feetNow) / dt);
      } else {
        if (s.grounded && !frozen && keys.has("Space")) s.vy = JUMP_SPEED;
        s.vy -= GRAVITY * dt;
      }

      // Bị đánh bật lùi: cộng thêm vận tốc đẩy, giảm dần.
      mx += knock.vx * dt;
      mz += knock.vz * dt;
      controller.computeColliderMovement(col, { x: mx, y: s.vy * dt, z: mz });
      const delta = controller.computedMovement();
      s.grounded = controller.computedGrounded();
      if (s.grounded && s.vy < 0) s.vy = 0;

      next = { x: pos.x + delta.x, y: pos.y + delta.y, z: pos.z + delta.z };
      if (next.y < world.heightAt(next.x, next.z) - 5) {
        // Lỡ lọt khỏi địa hình thì đưa về điểm xuất phát.
        next.x = spawn.x;
        next.y = spawn.y;
        next.z = spawn.z;
        s.vy = 0;
      }
    }
    const fade = Math.exp(-dt * 6);
    knock.vx *= fade;
    knock.vz *= fade;
    if (Math.abs(knock.vx) + Math.abs(knock.vz) < 0.05) knock.vx = knock.vz = 0;
    rb.setNextKinematicTranslation(next);

    // Vừa đánh hay ném: quay mặt theo hướng camera cho đòn đi đúng chỗ mình nhắm.
    if (!s.climb && performance.now() - localAim.at < AIM_FACE_MS) s.facing = localAim.yaw + Math.PI;

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
    const hit = physics.castRay(new rapier.Ray(camTarget, camDir), CAMERA_DISTANCE, true, undefined, undefined, col);
    const blocked = hit !== null;
    if (hit) camPos.copy(camTarget).addScaledVector(camDir, Math.max(CAMERA_MIN_DISTANCE, hit.timeOfImpact - 0.3));
    // Đang lặn thì camera được xuống nước theo; bơi trên mặt thì giữ camera trên mặt nước.
    const headUnder = feetY + HEAD_HEIGHT < WATER_LEVEL - 0.05;
    const minCamY = (headUnder ? world.heightAt(camPos.x, camPos.z) : Math.max(world.heightAt(camPos.x, camPos.z), WATER_LEVEL + 0.25)) + 0.5;
    if (camPos.y < minCamY) camPos.y = minCamY;
    if (headUnder && camPos.y > WATER_LEVEL - 0.3) camPos.y = WATER_LEVEL - 0.3;
    // Khung hình đầu đặt thẳng vào chỗ, không để camera bay từ giữa đảo tới.
    if (blocked || firstFrame) state.camera.position.copy(camPos);
    else state.camera.position.lerp(camPos, Math.min(1, dt * 10));
    state.camera.lookAt(camTarget);
    // Rung màn hình (bị đánh, cây đổ sát bên) và nghiêng ngả khi chóng mặt.
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.35;
      state.camera.position.x += (Math.random() - 0.5) * a;
      state.camera.position.y += (Math.random() - 0.5) * a;
      state.camera.position.z += (Math.random() - 0.5) * a;
      shake.amount *= Math.exp(-dt * 7);
    } else shake.amount = 0;
    if (dizzy > 0) state.camera.rotateZ(Math.sin(s.wobble * 1.7) * 0.14 * Math.min(1, dizzy));
    if (import.meta.env.DEV && debugCam.enabled) {
      state.camera.position.copy(debugCam.position);
      state.camera.lookAt(debugCam.target);
    }

    localPosition.set(next.x, feetY, next.z);
    localMotion.moving = s.climb ? climbMoving : moving;
    localMotion.running = moving && running;
    localMotion.climbing = !!s.climb;
    localMotion.sitting = s.sitting;
    localMotion.swimming = s.swimming;
    const inside = world.structureAt(next.x, next.z);
    const maxDepth = inside ? Math.max(1, ...inside.structure.depth) : 1;
    const indoorTarget = inside ? 0.45 + 0.55 * (inside.depth / maxDepth) : 0;
    localEnv.indoor += (indoorTarget - localEnv.indoor) * Math.min(1, dt * 3);
    localEnv.underwater = state.camera.position.y < WATER_LEVEL - 0.05;
    const items = sheet ? [...sheet.items] : [];
    localEnv.light = items.includes("lantern") || items.includes("torch");

    const anchor = frozen ? null : nearestOpenAnchor(room, next.x, next.z);
    setHud({
      zone: world.zoneAt(next.x, next.z),
      region: world.regionAt(next.x, next.z),
      swimming: s.swimming,
      underwater: headUnder,
      nearAnchor: anchor,
      nearTarget: frozen || anchor || s.climb ? null : nearestTarget(room, world, next.x, feetY, next.z),
      climbing: !!s.climb,
      victim: frozen || s.climb ? null : nearestVictim(room, next.x, feetY, next.z),
      sprint: Math.round(s.energy),
      atDigSite: !frozen && atDigSite(room, next.x, next.z),
      sitting: s.sitting,
      hidden: s.sitting && world.inTallGrass(next.x, next.z),
    });

    s.sendTimer += dt;
    if (s.sendTimer >= SEND_INTERVAL) {
      s.sendTimer = 0;
      const msg: MoveMessage = { x: next.x, y: feetY, z: next.z, rotY: s.facing, moving: s.climb ? climbMoving : moving, sitting: s.sitting, swimming: s.swimming };
      const key = `${msg.x.toFixed(2)},${msg.y.toFixed(2)},${msg.z.toFixed(2)},${msg.rotY.toFixed(2)},${msg.moving},${s.sitting},${s.swimming}`;
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
        <Carrier room={room}>{(carrying, held) => <Character ref={avatar} color={me.color} carrying={carrying} held={held} motion={() => readLocalMotion(room)} />}</Carrier>
      </group>
    </RigidBody>
  );
}

/** Dáng của mình: đi đứng tính ngay trên máy, động tác (đánh, ném, ăn) và choáng váng lấy từ server. */
const merged: Motion = { moving: false };
function readLocalMotion(room: IslandRoom): Motion {
  const sheet = room.state.players.get(myId(room));
  Object.assign(merged, localMotion);
  merged.act = sheet?.act;
  merged.actN = sheet?.actN;
  merged.stun = sheet?.stun;
  merged.dizzy = sheet?.dizzy;
  return merged;
}

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

/**
 * Thứ gần nhất nhấn E được: easter egg hay điểm bất thường chưa ai tìm thấy (đúng ngày nó hiện),
 * hoặc sinh vật thân thiện. Server kiểm tra lại khoảng cách.
 */
function nearestTarget(room: IslandRoom, world: World, x: number, y: number, z: number): NearTarget | null {
  const state = room.state;
  if (state.phase !== "dawn" && state.phase !== "explore" && state.phase !== "dusk") return null;
  let best: NearTarget | null = null;
  let bestDist = INTERACT_RADIUS;
  const found = new Set(state.discovered);
  for (const p of world.pois) {
    if (found.has(p.id) || (p.day !== 0 && p.day !== state.day) || Math.abs(p.y - y) > 3.5) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestDist) {
      const def = worldCatalog.pois.get(p.defId);
      best = { id: p.id, kind: "poi", label: def?.kind === "anomaly" ? `Chạm vào ${def.name.toLowerCase()}` : `Xem xét ${def?.name.toLowerCase() ?? "chỗ này"}` };
      bestDist = d;
    }
  }
  for (const [id, c] of state.creatures) {
    const def = worldCatalog.creatures.get(c.species);
    if (!def?.interact || Math.abs(c.y - y) > 4) continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= bestDist) {
      best = { id, kind: "creature", label: `Vuốt ve ${def.name.toLowerCase()}` };
      bestDist = d;
    }
  }
  if (best) return best;
  // Đồ nằm dưới đất: nhặt lên.
  bestDist = PICKUP_RADIUS;
  for (const [id, g] of state.groundItems) {
    if (Math.abs(g.y - y) > 2.5) continue;
    const d = Math.hypot(g.x - x, g.z - z);
    if (d <= bestDist) {
      best = { id, kind: "item", label: `Nhặt ${content.items.get(g.itemId)?.name.toLowerCase() ?? "món đồ"}` };
      bestDist = d;
    }
  }
  if (best) return best;
  // Trang nhật ký của hôm nay, chưa ai nhặt.
  for (const page of world.pages) {
    if (page.day !== state.day || found.has(page.id) || Math.abs(page.y - y) > 3) continue;
    if (Math.hypot(page.x - x, page.z - z) <= INTERACT_RADIUS) return { id: page.id, kind: "page", label: "Nhặt trang nhật ký" };
  }
  // Cạnh lửa trại: đang cầm đồ ăn thì nướng hoặc góp vào kho; sáng sớm hay ban ngày thì nhổ trại vác đi chỗ khác.
  if (!state.campPacked && Math.hypot(state.campX - x, state.campZ - z) <= CAMPFIRE_REACH) {
    const held = getPrivate()?.bag.find((b) => b.uid === getHands());
    const def = held && content.items.get(held.itemId);
    if (def?.cook) return { id: "campfire", kind: "campfire", label: `Nướng ${def.name.toLowerCase()}` };
    if (def?.ration) return { id: "campfire", kind: "campfire", label: `Góp ${def.name.toLowerCase()} vào kho (+${def.ration} khẩu phần)` };
    if (state.phase !== "dusk" && Math.hypot(state.campX - x, state.campZ - z) <= 3.5) return { id: "camp", kind: "camp", label: "Nhổ lửa trại mang đi" };
  }
  // Cây đủ lớn: leo lên.
  bestDist = CLIMB_REACH;
  for (const t of climbTrees(room, world)) {
    if (Math.abs(t.y - y) > 2) continue;
    const d = Math.hypot(t.x - x, t.z - z);
    if (d <= bestDist) {
      best = { id: t.id, kind: "tree", label: t.kind === "palm" ? "Leo cây dừa" : "Leo cây" };
      bestDist = d;
    }
  }
  return best;
}

/** Đứng cách lửa trại chừng này thì nướng, góp kho được (server kiểm tra lại). */
const CAMPFIRE_REACH = 4;

/** Kẻ phản bội (đúng lúc được ra tay) đứng sát ai đó: người đó có thể bị kết liễu bằng F. */
function nearestVictim(room: IslandRoom, x: number, y: number, z: number): { id: string; name: string } | null {
  if (!getPrivate()?.canAssassinate) return null;
  const me = myId(room);
  let best: { id: string; name: string } | null = null;
  let bestDist = ASSASSINATE_RADIUS;
  for (const [id, p] of room.state.players) {
    if (id === me || !p.alive || Math.abs(p.y - y) > 2) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestDist) {
      best = { id, name: p.name };
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

/** Vẽ lại nhân vật khi mình bắt đầu hay thôi vác rương, hay đổi món cầm trên tay. */
function Carrier({ room, children }: { room: IslandRoom; children: (carrying: boolean, held: string) => ReactNode }) {
  const carrying = useRoomSnapshot(room, (s) => s.treasureCarrier === myId(room) && !s.treasureSafe);
  const held = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.held ?? "");
  return <>{children(carrying, held)}</>;
}
