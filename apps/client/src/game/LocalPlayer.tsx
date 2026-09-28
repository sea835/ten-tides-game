import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { Vector3, type DirectionalLight, type Group } from "three";
import { heightAt, zoneAt } from "@tentides/content";
import { MAX_RUN_SPEED, Messages, type CorrectMessage, type MoveMessage } from "@tentides/protocol";
import type { IslandRoom } from "../net.ts";
import { Character } from "./Character.tsx";
import { setHud } from "./hudStore.ts";
import { keys, look } from "./input.ts";

const WALK_SPEED = 4.5;
const GRAVITY = 25;
const JUMP_SPEED = 8;
/** Nước sâu hơn mức này thì chưa lội qua được (bơi sẽ làm sau, gắn với sức bền). */
const MAX_WADE_DEPTH = 1.2;
const CAMERA_DISTANCE = 7;
const SEND_INTERVAL = 1 / 15;
const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.4;
const FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

type CharacterController = ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]>;

export function LocalPlayer({ room, sun }: { room: IslandRoom; sun: React.RefObject<DirectionalLight | null> }) {
  const me = room.state.players.get(room.sessionId)!;
  const spawn = useMemo(() => new Vector3(me.x, me.y, me.z), [me]);

  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const avatar = useRef<Group>(null);
  const { world } = useRapier();

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

  const sim = useRef({ vy: 0, grounded: false, facing: me.rotY, sendTimer: 0, lastSent: "" });
  const camTarget = useMemo(() => new Vector3(), []);
  const camPos = useMemo(() => new Vector3(), []);

  useEffect(() => {
    look.yaw = me.rotY + Math.PI;
    return room.onMessage(Messages.correct, (at: CorrectMessage) => {
      body.current?.setTranslation({ x: at.x, y: at.y + FEET_OFFSET, z: at.z }, true);
      sim.current.vy = 0;
    });
  }, [room, me]);

  useFrame((state, rawDt) => {
    const rb = body.current;
    const col = collider.current;
    const controller = controllerRef.current;
    if (!rb || !col || !controller) return;
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = running ? MAX_RUN_SPEED : WALK_SPEED;

    // Hướng "tới" là hướng camera đang nhìn, chiếu xuống mặt phẳng ngang.
    let mx = -Math.sin(look.yaw) * forward + Math.cos(look.yaw) * strafe;
    let mz = -Math.cos(look.yaw) * forward - Math.sin(look.yaw) * strafe;
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
    if (blockedByWater) {
      mx = 0;
      mz = 0;
    }

    if (s.grounded && keys.has("Space")) s.vy = JUMP_SPEED;
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
    camTarget.set(next.x, feetY + 1.6, next.z);
    const horizontal = Math.cos(look.pitch) * CAMERA_DISTANCE;
    camPos.set(
      camTarget.x + Math.sin(look.yaw) * horizontal,
      camTarget.y + Math.sin(look.pitch) * CAMERA_DISTANCE,
      camTarget.z + Math.cos(look.yaw) * horizontal,
    );
    const minCamY = Math.max(heightAt(camPos.x, camPos.z), 0) + 0.5;
    if (camPos.y < minCamY) camPos.y = minCamY;
    state.camera.position.lerp(camPos, Math.min(1, dt * 10));
    state.camera.lookAt(camTarget);

    // Mặt trời đi theo người chơi để shadow map nhỏ vẫn đủ nét.
    const light = sun.current;
    if (light) {
      light.position.set(next.x + 40, feetY + 60, next.z + 25);
      light.target.position.set(next.x, feetY, next.z);
      light.target.updateMatrixWorld();
    }

    setHud({ zone: zoneAt(next.x, next.z), deepWater: blockedByWater });

    s.sendTimer += dt;
    if (s.sendTimer >= SEND_INTERVAL) {
      s.sendTimer = 0;
      const msg: MoveMessage = { x: next.x, y: feetY, z: next.z, rotY: s.facing, moving };
      const key = `${msg.x.toFixed(2)},${msg.y.toFixed(2)},${msg.z.toFixed(2)},${msg.rotY.toFixed(2)},${moving}`;
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
        <Character ref={avatar} color={me.color} />
      </group>
    </RigidBody>
  );
}
