import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, type Group } from "three";
import { WEAPON } from "@tentides/content";
import { Messages, type ShotMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../../net.ts";
import { Character, type Motion } from "../Character.tsx";
import { playGunshot } from "../sound/guns.ts";
import { effects } from "./runtime.ts";
import { clearReplay, hasTrack, killcamSkip, oldestTime, record, recordShot, replay, replayPose, seek, setKillcam, shotsBetween, trackLook, useKillcam } from "./replay.ts";

// Killcam: mình gục (mọi chế độ) thì chiếu lại 5 giây cuối từ góc nhìn của kẻ hạ mình — camera sát vai kẻ đó nhìn theo
// hướng họ ngắm, người khác đứng đúng chỗ lúc ấy, vệt đạn vẽ lại. Không rõ kẻ hạ (vùng độc, ngã, nổ không chủ) thì
// bỏ qua. Bỏ qua được (Space hay nút), tự hết; hồi sinh (chiến trường), nhập máy (Đồng đội) thì dừng ngay.

/** Chiếu lại chừng này giây trước lúc gục, thêm chút sau đó. */
const BEFORE = 5;
const AFTER = 0.6;
/** Băng ngắn hơn mức này (vừa vào phòng) thì thôi. */
const MIN_WINDOW = 1;
/** Chờ dòng "ai hạ ai" tới (cùng gói hay gói sau) chừng này giây. */
const FEED_WAIT = 0.8;

const eye = new Vector3();
const camWant = new Vector3();
const lookWant = new Vector3();

/** Khung cảnh: ghi băng mọi lúc, phát lại khi mình gục, đặt camera, vẽ lại chính mình (người gục). */
export function Killcam({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const ghost = useRef<Group>(null);
  const [victim, setVictim] = useState<{ weapon: string; outfit: string; color: string } | null>(null);
  const kc = useRef({ wasAlive: true, pendingAt: 0, seenN: 0, t0: 0, tEnd: 0, started: 0, killer: "", lastShot: 0, camInit: false, cam: new Vector3(), look: new Vector3() });

  useEffect(() => {
    clearReplay();
    // Lần gục cũ (vào lại phòng) không chiếu.
    for (const e of room.state.feed) if (e.victim === me) kc.current.seenN = Math.max(kc.current.seenN, e.n);
    const off = room.onMessage(Messages.shot, (m: ShotMessage) => recordShot(m, performance.now() / 1000));
    return () => {
      off();
      replay.active = false;
      setKillcam(null);
    };
  }, [room, me]);

  const stop = () => {
    replay.active = false;
    replay.snap = true;
    killcamSkip.requested = false;
    setKillcam(null);
    setVictim(null);
  };

  useFrame(({ camera }, dt) => {
    const now = performance.now() / 1000;
    record(room, now);
    replay.snap = false;
    const st = room.state;
    const p = st.players.get(me);
    const alive = p?.alive ?? true;
    const fighting = st.phase === "battle" || st.phase === "prep";
    const s = kc.current;
    if (s.wasAlive && !alive && fighting) s.pendingAt = now;
    s.wasAlive = alive;
    if (s.pendingAt && !replay.active) {
      let entry: { killer: string; weapon: string; headshot: boolean; n: number } | null = null;
      for (const e of st.feed) if (e.victim === me && e.n > s.seenN) entry = e;
      if (entry) {
        s.seenN = entry.n;
        s.pendingAt = 0;
        const killer = entry.killer;
        const k = killer && killer !== me ? st.players.get(killer) : undefined;
        const window = Math.min(BEFORE, now - oldestTime());
        if (k && hasTrack(killer) && window >= MIN_WINDOW) {
          s.killer = killer;
          s.t0 = now - window;
          s.tEnd = now + AFTER;
          s.started = now;
          s.lastShot = s.t0;
          s.camInit = false;
          killcamSkip.requested = false;
          replay.active = true;
          replay.snap = true;
          seek(s.t0);
          setVictim(trackLook(me));
          setKillcam({
            killer,
            name: k.name,
            weapon: entry.weapon,
            headshot: entry.headshot,
            dist: p ? Math.round(Math.hypot(k.x - p.x, k.y - p.y, k.z - p.z)) : 0,
            duration: s.tEnd - s.t0,
            startedAt: performance.now(),
          });
        }
      } else if (now - s.pendingAt > FEED_WAIT) s.pendingAt = 0;
    }
    if (!replay.active) return;
    const rt = s.t0 + (now - s.started);
    if (alive || !fighting || killcamSkip.requested || rt >= s.tEnd || !st.players.has(s.killer)) {
      stop();
      return;
    }
    seek(rt);
    // Vệt đạn, lửa đầu nòng của các phát bắn trong đoạn vừa phát (tiếng súng chỉ của kẻ hạ mình).
    const born = now;
    shotsBetween(s.lastShot, Math.min(rt, now - 0.05), (shot) => {
      const def = WEAPON.get(shot.w);
      effects.tracers.push({ ox: shot.ox, oy: shot.oy, oz: shot.oz, ex: shot.ex, ey: shot.ey, ez: shot.ez, born, mine: shot.id === s.killer, speed: def?.velocity });
      if (!shot.quiet) effects.flashes.push({ x: shot.ox, y: shot.oy, z: shot.oz, born });
      if (shot.id === s.killer) playGunshot(shot.w, { x: shot.ox, y: shot.oy, z: shot.oz }, false, shot.quiet);
    });
    s.lastShot = Math.max(s.lastShot, Math.min(rt, now - 0.05));
    // Chính mình (đã gục): vẽ lại đúng chỗ, đúng tư thế lúc ấy.
    const g = ghost.current;
    const vp = replayPose(me);
    if (g) {
      g.visible = !!vp && vp.alive;
      if (vp) {
        g.position.set(vp.x, vp.y, vp.z);
        g.rotation.y = vp.rotY;
      }
    }
    // Camera sát vai phải kẻ hạ mình, nhìn theo hướng họ ngắm.
    const kp = replayPose(s.killer);
    if (!kp) return;
    const h = kp.prone ? 0.45 : kp.crouching ? 1.2 : 1.62;
    const cp = Math.cos(kp.aimPitch);
    const fx = Math.sin(kp.rotY) * cp;
    const fy = Math.sin(kp.aimPitch);
    const fz = Math.cos(kp.rotY) * cp;
    eye.set(kp.x, kp.y + h, kp.z);
    camWant.set(eye.x - Math.sin(kp.rotY) * 0.75 - Math.cos(kp.rotY) * 0.38, eye.y + 0.12, eye.z - Math.cos(kp.rotY) * 0.75 + Math.sin(kp.rotY) * 0.38);
    lookWant.set(eye.x + fx * 30, eye.y + fy * 30, eye.z + fz * 30);
    if (!s.camInit) {
      s.camInit = true;
      s.cam.copy(camWant);
      s.look.copy(lookWant);
    } else {
      const a = Math.min(1, dt * 14);
      s.cam.lerp(camWant, a);
      s.look.lerp(lookWant, a);
    }
    camera.position.copy(s.cam);
    camera.lookAt(s.look);
  }, -0.5);

  // Dáng mình lúc phát lại (một đối tượng dùng chung).
  const motion = useMemo(() => {
    const m: Motion = { moving: false };
    return () => {
      const vp = replayPose(me);
      m.moving = vp?.moving ?? false;
      m.crouching = vp?.crouching;
      m.prone = vp?.prone;
      m.aiming = vp?.aiming;
      m.aimPitch = vp?.aimPitch;
      m.lean = vp?.lean;
      m.firing = vp?.shots;
      return m;
    };
  }, [me]);

  if (!victim) return null;
  return (
    <group ref={ghost} visible={false}>
      <Character color={victim.color} weapon={victim.weapon} outfit={victim.outfit} motion={motion} />
    </group>
  );
}

const WEAPON_LABEL: Record<string, string> = { zone: "vùng độc", mine: "mìn", frag: "lựu đạn", knife: "dao", tank: "pháo xe tăng", collapse: "nhà sập" };

/** Dải "KILLCAM" trên màn hình: kẻ hạ mình, súng, khoảng cách, thanh thời gian, nút bỏ qua (Space). */
export function KillcamHud() {
  const kc = useKillcam();
  useEffect(() => {
    if (!kc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      killcamSkip.requested = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kc]);
  if (!kc) return null;
  const weapon = WEAPON_LABEL[kc.weapon] ?? WEAPON.get(kc.weapon)?.name ?? kc.weapon;
  return (
    <div className="b-killcam" key={kc.startedAt}>
      <div className="kc-bar top" />
      <div className="kc-bar bottom" />
      <div className="kc-head">
        <span className="kc-tag">
          <i /> KILLCAM
        </span>
        <span className="kc-who">
          {kc.name} · {weapon}
          {kc.headshot ? " · vào đầu" : ""} · {kc.dist} m
        </span>
        <button
          className="kc-skip"
          onClick={() => {
            killcamSkip.requested = true;
          }}
        >
          Bỏ qua <kbd>Space</kbd>
        </button>
        <div className="kc-progress" style={{ animationDuration: `${kc.duration}s` }} />
      </div>
    </div>
  );
}
