import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AgXToneMapping,
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  CircleGeometry,
  ShaderMaterial,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from "three";
import { SIGHTS, WEAPON, gadgetIn, type SightId } from "@tentides/content";
import { myId, type IslandRoom } from "../../net.ts";
import { camoTexture } from "../camo.ts";
import { DRAW_ON_TOP_GLSL, GunModel, KnifeModel, MagModel, ThrowableModel, actionTravel, aimLineHeight, drawOnTop, ejectPort, hasMag, magCenter, muzzleOffset, opticHeight, railMount, supportOffset, viewMaterial } from "../GunModel.tsx";
import { isTyping, view } from "../input.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { gun } from "./Shooter.tsx";
import { getSettings } from "../settings.ts";
import { effects, eject, hitStopScale, muzzle, recoil, seat, stance } from "./runtime.ts";
import { localPosition } from "../shared.ts";
import { viewGlint } from "../viewGlint.ts";
import { BarrelFx, barrelFxHook, type BarrelFxApi } from "./BarrelFx.tsx";
import { INSPECT_DUR, cancelInspect, cancelsInspect, inspect, inspectPose, newPose, startInspect } from "./viewInspect.ts";
import { landKick, newInertia, resetInertia, updateInertia } from "./viewInertia.ts";

// Súng trước mặt khi nhìn bằng mắt (góc thứ nhất): cầm thấp bên phải, lắc theo bước chân, trễ theo cú xoay chuột,
// giật như lò xo khi bắn (báng lùi vào vai, nòng hất lên, lệch ngang, nghiêng), nhún khi đáp đất; ngắm thì nâng
// lên giữa mắt cho thước ngắm trùng tâm màn hình; thay đạn thì hạ nòng xuống; dí sát tường thì dựng nòng lên, kéo
// súng về ngực. Vật liệu vẽ đè lên cảnh (viewMaterial) nên không bao giờ xuyên qua tường. Nhìn qua ống ngắm thì ẩn.
// Hai bàn tay đeo găng nắm tay cầm và ốp lót tay, cẳng tay mặc vải rằn ri đúng bộ đang mặc; ống ngắm lắp trên ray,
// kính phản xạ có chấm đỏ / vòng holo sáng; bắn thì lửa loé ở đầu nòng (sao lửa trước mặt, lưỡi lửa hai bên).

const HIP = new Vector3(0.24, -0.25, -0.5);

/** Lớp vẽ riêng của súng trước mặt. */
export const VIEW_LAYER = 5;

/**
 * Vẽ súng trước mặt sau cùng, trên nền cảnh đã xử lý hậu kỳ, với bộ đệm độ sâu xoá sạch: không bao giờ xuyên tường,
 * và hiệu ứng che bóng (AO) không làm súng đen sì chớp tắt (AO đọc độ sâu, súng sát ống kính làm nó tính sai).
 * Đồ hoạ thấp (không hậu kỳ) thì lượt này vẽ luôn cảnh chính, vì R3F thôi tự vẽ khi có useFrame ưu tiên.
 */
export function ViewPass({ post }: { post: boolean }) {
  const lightsAt = useRef(0);
  useFrame(({ gl, scene, camera }) => {
    if (!post) gl.render(scene, camera);
    const now = performance.now();
    if (now - lightsAt.current > 1000) {
      lightsAt.current = now;
      // Đèn phải cùng lớp thì mới chiếu lên súng.
      scene.traverse((o) => {
        if ((o as { isLight?: boolean }).isLight) o.layers.enable(VIEW_LAYER);
      });
    }
    if (!stance.firstPerson) return;
    const autoClear = gl.autoClear;
    const toneMapping = gl.toneMapping;
    const shadows = gl.shadowMap.autoUpdate;
    const background = scene.background;
    gl.autoClear = false;
    gl.shadowMap.autoUpdate = false;
    if (post) gl.toneMapping = AgXToneMapping;
    scene.background = null;
    // Súng trước mặt vẽ với góc nhìn gốc: ngắm thì cảnh phóng to còn súng giữ nguyên cỡ (như mắt thật), trước đây
    // súng bị phóng to theo, khối súng sát mắt che mất giữa màn hình.
    const cam = camera as PerspectiveCamera;
    const zoomedFov = cam.fov;
    const baseFov = getSettings().fov;
    if (Math.abs(zoomedFov - baseFov) > 0.01) {
      cam.fov = baseFov;
      cam.updateProjectionMatrix();
    }
    // Khí nóng đầu nòng: chép nền quanh đầu nòng trước khi vẽ súng (BarrelFx).
    barrelFxHook.beforeView?.(gl, cam);
    camera.layers.set(VIEW_LAYER);
    gl.clearDepth();
    gl.render(scene, camera);
    camera.layers.set(0);
    if (cam.fov !== zoomedFov) {
      cam.fov = zoomedFov;
      cam.updateProjectionMatrix();
    }
    scene.background = background;
    gl.toneMapping = toneMapping;
    gl.shadowMap.autoUpdate = shadows;
    gl.autoClear = autoClear;
  }, 2);
  return null;
}
const flashPos = new Vector3();
const q = new Quaternion();
const tilt = new Quaternion();
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const axisZ = new Vector3(0, 0, 1);

/** Lò xo tắt dần (gần tới hạn) cho từng trục giật. */
interface Spring {
  x: number;
  v: number;
}
function step(sp: Spring, dt: number, k: number, c: number) {
  sp.v += (-k * sp.x - c * sp.v) * dt;
  sp.x += sp.v * dt;
}

/** Dốc lên rồi xuống trong khoảng [a, b] của tiến trình t (0 ngoài khoảng, 1 ở giữa), mượt hai đầu. */
function bump(t: number, a: number, b: number): number {
  if (t <= a || t >= b) return 0;
  return Math.sin(((t - a) / (b - a)) * Math.PI);
}
/** Tiến trình 0–1 trong khoảng [a, b], mượt hai đầu. */
function ramp(t: number, a: number, b: number): number {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

const THROWN_SLOTS = ["frag", "smoke", "flash", "mine", "syringe", "binoculars", "ammobox", "sandbag", "repair", "atmine"];
const slot0 = (s: string) => s === "gadget1" || s === "gadget2";
const _v = new Vector3();
const _w = new Vector3();
const _vel = new Vector3();
const _lastPos = new Vector3();
const _camInv = new Quaternion();
const pose = newPose();

export function ViewModel({ room }: { room: IslandRoom }) {
  const g = useRef<Group>(null);
  const gunG = useRef<Group>(null);
  const itemG = useRef<Group>(null);
  const knifeG = useRef<Group>(null);
  const throwG = useRef<Group>(null);
  const leftG = useRef<Group>(null);
  const spareMag = useRef<Group>(null);
  const ejectRef = useRef<Group>(null);
  const s = useRef({
    aim: 0,
    bob: 0,
    wall: 0,
    sprint: 0,
    fired: 0,
    actionAt: -1e9,
    back: { x: 0, v: 0 } as Spring,
    rise: { x: 0, v: 0 } as Spring,
    side: { x: 0, v: 0 } as Spring,
    roll: { x: 0, v: 0 } as Spring,
    lastLand: 0,
    reloadWas: false,
    /** Quán tính súng (lia chuột, đi lại, bay, đáp đất). */
    inertia: newInertia(),
    hadPos: false,
    /** Món đang cầm lúc bắt đầu ngắm nghía (đổi món là huỷ). */
    inspectHeld: "",
  });
  const fx = useRef<BarrelFxApi>(null);
  const held = useRoomSnapshot(room, (st) => {
    const p = st.players.get(myId(room));
    const k = p?.kit;
    if (!k || !p.alive) return "";
    // Khí tài lớp lính: M203 thì cầm súng trường chính (ống phóng dưới nòng); khí tài khác cầm như đồ ném.
    const gadget = (slot0(k.active) && st.battleMode !== "solo" && gadgetIn(p.gear.cls, k.active)) || "";
    const slot = gadget === "m203" ? "primary1" : k.active;
    const w = slot === "primary1" || slot === "primary2" || slot === "pistol" ? k[slot] : "";
    const sg = slot === "primary1" ? k.sight1 : slot === "primary2" ? k.sight2 : slot === "pistol" ? k.sightP : "";
    let at = slot === "primary1" ? k.att1 : slot === "primary2" ? k.att2 : slot === "pistol" ? k.attP : "";
    // Lính Đột Kích: ống phóng lựu M203 lắp dưới nòng súng trường.
    if (p.gear.cls === "assault" && st.battleMode !== "solo" && WEAPON.get(w)?.class === "ar") at = at ? `${at},m203` : "m203";
    // Skin súng đang lắp cho khẩu này (tài khoản), để súng trước mặt cũng mang skin.
    const sk = w ? (p.skins.get(w) ?? "") : "";
    return `${gadget && gadget !== "m203" ? gadget : slot}|${w}|${sg}|${k.outfit}|${at}|${sk}`;
  });
  const [slot = "", weapon = "", sightId = "", outfit = "woodland", atts = "", skin = ""] = held.split("|");
  const def = WEAPON.get(weapon);
  const sight = def ? aimLineHeight(weapon, sightId) : 0;
  const thrown = THROWN_SLOTS.includes(slot) ? slot : "";
  const flash = useRef<Group>(null);
  const flashState = useRef({ fired: 0, until: 0 });
  const support = useMemo(() => (def ? supportOffset(weapon, atts) : ([0, 0, 0.2] as [number, number, number])), [def, weapon, atts]);
  const magAt = useMemo(() => (def ? magCenter(weapon) : ([0, -0.1, 0.1] as [number, number, number])), [def, weapon]);

  useFrame(({ camera }, rawDt) => {
    const m = g.current;
    if (!m) return;
    // Hitstop (phát hạ bằng súng khóa nòng): súng trên tay khựng lại một nhịp; camera vẫn theo chuột như thường.
    const dt = Math.min(rawDt, 0.05) * hitStopScale();
    const st = s.current;
    const now = performance.now();
    // Vận tốc của mình (toạ độ thế giới), từ vị trí hai khung liền nhau; dịch chuyển tức thời thì bỏ qua.
    if (st.hadPos && rawDt > 1e-4) {
      _vel.subVectors(localPosition, _lastPos).divideScalar(rawDt);
      if (_vel.lengthSq() > 400) _vel.set(0, 0, 0);
    } else _vel.set(0, 0, 0);
    _lastPos.copy(localPosition);
    st.hadPos = true;
    const scoped = stance.aiming && stance.scoped;
    const show = !!held && stance.firstPerson && !scoped;
    m.visible = show;
    // Súng trước mặt nằm ở lớp riêng: không lọt vào lượt vẽ chính (che bóng AO, bloom), ViewPass vẽ đè sau cùng.
    m.traverse((o) => o.layers.set(VIEW_LAYER));
    if (!show) {
      muzzle.valid = false;
      eject.valid = false;
      st.fired = recoil.fired;
      resetInertia(st.inertia, view.yaw, view.pitch);
      st.hadPos = false;
      if (inspect.at) cancelInspect();
      inspect.weight = 0;
      inspect.request = false;
      viewGlint.value.w = 0;
      fx.current?.update(dt, now / 1000, camera, false);
      return;
    }
    // Cả bộ đi theo camera; các món bên trong đặt theo toạ độ camera (−z là phía trước).
    m.position.copy(camera.position);
    m.quaternion.copy(camera.quaternion);

    const ease = (rate: number) => Math.min(1, dt * rate);
    st.wall += (stance.wall - st.wall) * ease(12);
    const aimTarget = stance.aiming ? 1 - st.wall : 0;
    st.aim += (aimTarget - st.aim) * ease(14);
    st.sprint += ((stance.sprinting && !stance.aiming ? 1 : 0) - st.sprint) * ease(8);
    if (stance.moving && !stance.airborne) st.bob += dt * (4 + stance.speed * 1.25);

    // Rút món mới: đưa từ dưới lên (0 là đã cầm chắc).
    const raise = 1 - ramp((now - stance.swapAt) / 1000, 0, stance.swapDur);
    // Đâm dao: súng hạ xuống tránh chỗ cho dao, dao chém từ phải sang trái.
    const meleeT = (now - stance.meleeAt) / 1000;
    const meleeK = meleeT < 0.5 ? meleeT / 0.5 : 1;
    const meleeOn = meleeK < 1;

    // Ngắm nghía (phím I): chỉ khi cầm súng, đứng yên tay (không ngắm, thay đạn, chạy, rút súng, đâm dao). Mọi việc
    // khác (bắn, ngắm, thay đạn, chạy, đổi món) huỷ ngay.
    const reloadingNow = gun.reloadUntil > now;
    const insT = inspect.hold >= 0 ? inspect.hold : (now - inspect.at) / 1000;
    if (inspect.request) {
      inspect.request = false;
      if (def && !stance.aiming && !reloadingNow && !stance.sprinting && raise < 0.05 && !meleeOn && !inspect.at) {
        startInspect(now);
        st.inspectHeld = held;
      }
    }
    if (
      inspect.at &&
      (insT >= INSPECT_DUR ||
        recoil.fired !== st.fired ||
        stance.aiming ||
        reloadingNow ||
        stance.sprinting ||
        stance.swapAt > inspect.at ||
        stance.meleeAt > inspect.at ||
        held !== st.inspectHeld)
    )
      cancelInspect();
    if (inspect.at) inspectPose(insT, pose);
    else inspect.weight *= Math.exp(-dt * 28);
    if (!inspect.at && inspect.weight < 0.002) inspect.weight = 0;
    const insW = inspect.weight;
    // Vệt sáng quét qua kim loại (toạ độ camera): nguồn sáng ảo lướt ngang trước mặt.
    viewGlint.value.set(pose.sweep, 0.45, 0.85, 0).normalize();
    viewGlint.value.w = pose.glint * insW;

    // Phát bắn mới: đá lò xo (mạnh hơn khi bắn từ hông), khoá nòng lùi về rồi lao lên.
    if (recoil.fired !== st.fired) {
      const n = recoil.fired - st.fired;
      st.fired = recoil.fired;
      if (def) fx.current?.shot(now / 1000, n, def.class === "sniper" || def.class === "shotgun" || def.class === "dmr");
      const p = recoil.power * n * (1 - st.aim * 0.3);
      st.back.v += 2.4 * p;
      st.rise.v += 4.6 * p;
      st.side.v += (Math.random() - 0.5) * 2.4 * p;
      st.roll.v += (Math.random() - 0.5) * 6 * p;
      st.actionAt = now;
    }
    // Đáp đất: nhún theo độ nặng cú rơi (LocalPlayer tính từ vận tốc rơi).
    if (stance.land > st.lastLand + 0.05) landKick(st.inertia, stance.land);
    st.lastLand = stance.land;
    step(st.back, dt, 300, 24);
    step(st.rise, dt, 220, 20);
    step(st.side, dt, 200, 20);
    step(st.roll, dt, 170, 17);
    // Quán tính: vận tốc đổi sang toạ độ camera (x phải, y lên, z lùi).
    _camInv.copy(camera.quaternion).invert();
    _w.copy(_vel).applyQuaternion(_camInv);
    const it = st.inertia;
    updateInertia(it, dt, view.yaw, view.pitch, _w.x, _vel.y, _w.z, st.aim, stance.airborne);
    // Nhịp bước: ngang theo nhịp chân, lên xuống gấp đôi (hình số 8), nghiêng nhẹ theo bước. Ngắm thì gần như đứng yên.
    const bobAmt = (0.008 + Math.min(1, stance.speed / 7) * 0.02) * (1 - st.aim * 0.85) * (stance.moving && !stance.airborne ? 1 : 0.15);
    const bobX = Math.sin(st.bob) * bobAmt + it.x;
    const bobY = (Math.abs(Math.cos(st.bob)) - 0.5) * bobAmt + it.y;
    const bobRoll = Math.sin(st.bob) * bobAmt * 1.6;

    // ---------------------------------------------------------------- súng
    const gg = gunG.current;
    if (gg) {
      gg.visible = !!def;
      if (def) {
        // Thay đạn: tiến trình 0–1 theo thời gian thay đạn của súng.
        const reloading = gun.reloadUntil > now;
        const r = reloading ? 1 - (gun.reloadUntil - now) / (gun.reloadDur * 1000) : 1;
        const tiltK = reloading ? ramp(r, 0, 0.12) * (1 - ramp(r, 0.86, 1)) : 0;
        const lower = Math.max(raise, meleeOn ? bump(meleeK, 0, 1) * 0.9 : 0);
        const hip = 1 - st.aim;
        // Ngắm nghía: cộng tư thế (đã hoà theo insW); súng lục nhỏ thì đưa vào giữa ít hơn.
        const ip = insW * (def.class === "pistol" ? 0.75 : 1);
        gg.position.set(
          HIP.x * hip + bobX + st.side.x * 0.025 - st.wall * 0.06 - st.sprint * 0.06 - tiltK * 0.06 + lower * 0.05 + pose.px * ip,
          HIP.y * hip - sight * st.aim + bobY - st.wall * 0.06 - st.sprint * 0.03 + tiltK * 0.03 - lower * 0.32 + pose.py * ip,
          HIP.z * hip - (def.class === "pistol" ? 0.3 : 0.4) * st.aim + st.back.x * 0.07 + st.wall * 0.24 + st.sprint * 0.06 + tiltK * 0.05 + it.z + pose.pz * ip,
        );
        // Nòng hất lên khi giật, chúc xuống khi rút súng; sát tường dựng lên; thay đạn thì nghiêng súng (lật cửa
        // băng đạn về phía mình) và ngóc nòng.
        q.identity();
        tilt.setFromAxisAngle(axisX, st.rise.x * 0.11 + st.wall * 1.05 + it.rx + tiltK * 0.2 - lower * 0.9 + pose.rx * insW);
        q.multiply(tilt);
        tilt.setFromAxisAngle(axisY, st.side.x * 0.05 + st.sprint * 0.55 + st.wall * 0.25 + lower * 0.3 + it.ry + pose.ry * insW);
        q.multiply(tilt);
        tilt.setFromAxisAngle(axisZ, st.roll.x * 0.07 + st.sprint * 0.25 + st.wall * 0.35 + tiltK * 0.55 + it.rz + bobRoll + pose.rz * insW);
        q.multiply(tilt);
        gg.quaternion.copy(q);
        gg.rotateY(Math.PI);

        // Băng đạn: rút ra rơi xuống, lắp băng mới từ tay trái đẩy lên. Tay trái rời ốp lót tay đi lấy băng.
        const magG = gg.getObjectByName("mag");
        const withMag = hasMag(weapon);
        // Băng nằm trên nóc (đĩa đạn DP-28): nhấc lên tháo ra thay vì rút xuống.
        const topMag = magAt[1] > 0.1;
        if (magG) {
          const out = reloading && withMag ? ramp(r, 0.12, 0.3) : 0;
          const back = reloading && withMag ? ramp(r, 0.62, 0.76) : 1;
          const gone = reloading && withMag && r > 0.3 && r < 0.62;
          // Ống phóng: quả đạn đã bay đi thì miệng ống trống tới khi nạp quả mới.
          const fired = def.class === "launcher" && gun.mag <= 0 && !(reloading && r >= 0.62);
          magG.visible = !gone && !fired;
          const drop = r < 0.5 ? out : 1 - back;
          magG.position.set(topMag ? 0.06 * drop : 0, (topMag ? 0.2 : -0.22) * drop, -0.03 * drop);
          magG.rotation.set((topMag ? -0.25 : 0.35) * drop, 0, topMag ? 0.4 * drop : 0);
        }
        const lg = leftG.current;
        if (lg) {
          // Các chặng: tới băng đạn (0,1–0,2) → theo băng xuống, khuất dưới (0,2–0,45) → mang băng mới lên (0,45–0,62)
          // → đẩy băng vào (0,62–0,76) → về ốp lót tay (0,76–0,9).
          _v.set(...support);
          if (reloading && def.shell) {
            // Nạp từng viên: tay trái xuống túi đạn ở hông lấy một viên, đưa lên nhét vào cửa nạp dưới hộp khoá nòng.
            const into = gun.reloadDur * r - def.reload;
            const ph = into > 0 ? (into % def.shell) / def.shell : 0;
            const away = into > 0 ? bump(ph, 0, 0.9) : 0;
            _w.set(0.0, -0.02, 0.06);
            _v.lerp(_w, ramp(r, 0, 0.08) * (1 - ramp(r, 0.94, 1)));
            _v.y -= away * 0.2;
            _v.x += away * 0.06;
            _v.z -= away * 0.05;
          } else if (reloading) {
            const toMag = ramp(r, 0.08, 0.2);
            const down = ramp(r, 0.2, 0.36) * (1 - ramp(r, 0.44, 0.6));
            const home = ramp(r, 0.76, 0.9);
            _w.set(magAt[0] + 0.01, magAt[1] + (topMag ? 0.05 : -0.07), magAt[2]);
            _v.lerp(_w, toMag * (1 - home));
            _v.y += down * (topMag ? 0.22 : -0.42);
            _v.z -= down * 0.12;
            _v.x += down * 0.08;
            if (r > 0.62 && r < 0.76) _v.y += 0.02 * bump(r, 0.62, 0.76);
          }
          // Ngắm nghía: tay trái vuốt dọc ốp lót tay về phía đầu nòng rồi lùi về, nhấc nhẹ khỏi ốp.
          _v.z += pose.hand * insW;
          _v.y += pose.hand * insW * 0.12;
          lg.position.copy(_v);
          if (spareMag.current) spareMag.current.visible = reloading && withMag && r > 0.36 && r < 0.62;
        }
        // Khoá nòng / khối trượt: lùi về khi bắn; súng lục hết đạn thì khối trượt kẹt ở sau; súng khoá nòng kéo khoá
        // sau mỗi phát; thay đạn xong thì kéo khoá lên đạn.
        const act = gg.getObjectByName("action");
        if (act) {
          const travel = actionTravel(weapon);
          const since = (now - st.actionAt) / 1000;
          let k = 0;
          if (def.class === "sniper") k = bump(since, 0.35, 0.95);
          // Shotgun bơm: kéo ốp bơm về rồi đẩy tới ngay sau phát bắn (tay trái kéo theo, xem dưới).
          else if (def.pump) k = bump(since, 0.12, 0.5);
          else k = since < 0.07 ? 1 - since / 0.07 : 0;
          if (def.class === "pistol" && gun.mag <= 0 && !reloading) k = 1;
          if (reloading && def.class !== "pistol" && !def.shell) k = Math.max(k, bump(r, 0.8, 0.94));
          if (reloading && def.class === "pistol") k = Math.max(k, 1 - ramp(r, 0.78, 0.86));
          act.position.z = -travel * k;
          if (def.pump && lg) lg.position.z -= travel * k;
        }
      }
    }

    // ---------------------------------------------------------------- dao, lựu đạn trên tay phải
    const ig = itemG.current;
    const kg = knifeG.current;
    const tg = throwG.current;
    if (ig && kg && tg) {
      const knifeIdle = !def && !thrown;
      kg.visible = knifeIdle || meleeOn;
      tg.visible = !!thrown && !meleeOn;
      ig.visible = kg.visible || tg.visible;
      if (kg.visible) {
        // Dao: cầm thấp bên phải chĩa tới; chém là vung từ phải trên xuống trái dưới rồi thu về.
        const swing = meleeOn ? meleeK : 1;
        const cut = ramp(swing, 0.12, 0.45);
        const back = ramp(swing, 0.55, 1);
        const wind = bump(swing, 0, 0.2);
        const k2 = cut * (1 - back);
        kg.position.set(0.24 + wind * 0.1 - k2 * 0.42 + bobX, -0.24 + wind * 0.1 + bobY - (knifeIdle ? raise * 0.35 : 0), -0.42 - k2 * 0.12);
        kg.rotation.set(-0.35 - wind * 0.5 + k2 * 0.3, 0.35 + k2 * 1.1, -0.25 - wind * 0.4 + k2 * 0.9);
      }
      if (tg.visible) {
        // Lựu đạn: cầm trước ngực; rút chốt thì vung tay ra sau lên cao; ném thì vung tới trước rồi buông.
        const cook = stance.cookAt ? ramp((now - stance.cookAt) / 1000, 0, 0.25) : 0;
        const tt = (now - stance.throwAt) / 1000;
        const throwing = tt < 0.3;
        const fling = throwing ? ramp(tt, 0, 0.18) : 0;
        const gone = tt >= 0.18 && tt < 0.7;
        const reRaise = tt >= 0.7 && tt < 1.05 ? 1 - ramp(tt, 0.7, 1.05) : 0;
        const low = Math.max(raise, reRaise);
        tg.visible = !gone;
        tg.position.set(
          0.2 + bobX + cook * 0.1 - fling * 0.3,
          -0.2 + bobY + cook * 0.2 - low * 0.35 + fling * 0.12,
          -0.38 + cook * 0.24 - fling * 0.5,
        );
        tg.rotation.set(-0.3 + cook * 0.9 - fling * 1.4, -0.3, 0.2 - cook * 0.3);
      }
    }

    // Lửa đầu nòng: loé chừng 1–2 khung hình sau mỗi phát, to nhỏ, xoay ngẫu nhiên; chiếu sáng xung quanh.
    const f = flash.current;
    if (f && def) {
      const fs = flashState.current;
      if (recoil.fired !== fs.fired) {
        fs.fired = recoil.fired;
        fs.until = now + 45;
        const big = def.class === "sniper" || def.class === "shotgun" || def.class === "dmr" ? 1.5 : def.class === "pistol" || def.class === "smg" ? 0.8 : 1;
        f.scale.setScalar(big * (0.8 + Math.random() * 0.45));
        f.rotation.z = Math.random() * Math.PI;
      }
      // Giảm thanh, che lửa: không loé lửa.
      f.visible = now < fs.until && !gun.flashless;
      m.updateMatrixWorld();
      f.getWorldPosition(flashPos);
      muzzle.x = flashPos.x;
      muzzle.y = flashPos.y;
      muzzle.z = flashPos.z;
      muzzle.valid = true;
      if (f.visible && fs.until - now > 30) effects.flashes.push({ x: flashPos.x, y: flashPos.y, z: flashPos.z, born: now / 1000, lightOnly: true });
      // Cửa thoát vỏ đạn (thế giới) và trục phải của súng, để vỏ đạn văng đúng chỗ.
      const ej = ejectRef.current;
      if (ej && gg) {
        ej.getWorldPosition(_v);
        eject.x = _v.x;
        eject.y = _v.y;
        eject.z = _v.z;
        _w.set(-1, 0, 0).transformDirection(gg.matrixWorld);
        eject.rx = _w.x;
        eject.ry = _w.y;
        eject.rz = _w.z;
        eject.valid = true;
      }
    } else {
      muzzle.valid = false;
      eject.valid = false;
    }
    // Khí nóng, khói nòng (sau khi đã đặt đầu nòng, cửa thoát vỏ của khung này).
    fx.current?.update(dt, now / 1000, camera, !!def);
  });

  // Phím I: ngắm nghía súng; bấm chuột, lăn chuột hay phím việc khác thì huỷ ngay (không chờ khung hình sau).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || seat.id) return;
      if (e.code === "KeyI") {
        if (!e.repeat) inspect.request = true;
      } else if (inspect.at && cancelsInspect(e.code)) cancelInspect();
    };
    const onCancel = () => {
      if (inspect.at) cancelInspect();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onCancel);
    window.addEventListener("wheel", onCancel, { passive: true });
    if (import.meta.env.DEV) {
      // Dev: thử ngắm nghía khi không có bàn phím (window.__tentides.inspect()).
      const w = window as unknown as { __tentides?: Record<string, unknown> };
      w.__tentides ??= {};
      w.__tentides.inspect = () => {
        inspect.request = true;
      };
      w.__tentides.inspectState = inspect;
      w.__tentides.barrelFx = fx;
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onCancel);
      window.removeEventListener("wheel", onCancel);
      cancelInspect();
      viewGlint.value.w = 0;
    };
  }, []);

  return (
    <group ref={g}>
      <group ref={gunG}>
        {def && (
          <>
            <GunModel weaponId={weapon} sight={sightId} atts={atts} skin={skin} scale={1} view />
            {(sightId || weapon === "scar") && <Reticle weapon={weapon} sight={sightId || "builtin"} />}
            <RightHand />
            <group ref={leftG} position={support}>
              <LeftHand outfit={outfit} pistol={def.class === "pistol"} />
              <group ref={spareMag} position={[-0.005, 0.045, 0]} visible={false}>
                <MagModel weaponId={weapon} view />
              </group>
            </group>
            <RightArm outfit={outfit} />
            <group position={ejectPort(weapon)}>
              <group ref={ejectRef} />
            </group>
            <group position={muzzleOffset(weapon, atts)}>
              <group ref={flash} visible={false}>
                <MuzzleFlash />
              </group>
            </group>
          </>
        )}
      </group>
      <group ref={itemG}>
        <group ref={knifeG} visible={false}>
          {/* Dao dựng mũi theo +z; toạ độ camera nhìn về −z nên quay nửa vòng cho mũi dao chĩa tới trước. */}
          <group rotation-y={Math.PI}>
            <KnifeModel view />
          </group>
          <HoldingHand outfit={outfit} />
        </group>
        <group ref={throwG} visible={false}>
          {thrown && (
            <group position={[0, 0.02, 0.02]} scale={thrown === "ammobox" ? 0.5 : thrown === "atmine" ? 0.7 : 1}>
              <ThrowableModel id={thrown} view />
            </group>
          )}
          <HoldingHand outfit={outfit} />
        </group>
      </group>
      <BarrelFx api={fx} layer={VIEW_LAYER} />
    </group>
  );
}

// ---------------------------------------------------------------------------- lửa đầu nòng

const flashVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${DRAW_ON_TOP_GLSL}
  }
`;
/** Sao lửa nhìn thẳng từ phía sau súng: lõi trắng, 5 cánh vàng cam. */
const starFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    // atan(0, 0) không xác định (NaN trên vài GPU → mảng đen nhấp nháy qua bloom): lệch một chút.
    float a = atan(p.y, p.x + 1e-5);
    float petals = 0.45 + 0.55 * pow(abs(cos(a * 2.5)), 3.0);
    float glow = 1.0 - smoothstep(0.0, petals, r);
    float core = 1.0 - smoothstep(0.0, 0.35, r);
    vec3 c = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.55), glow) + core * 2.0;
    gl_FragColor = vec4(c * 5.0 * glow, glow);
  }
`;
/** Lưỡi lửa dọc nòng (nhìn ngang): đậm ở gốc, nhọn và tắt dần về phía trước. */
const tongueFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float along = vUv.y;
    float width = (1.0 - along) * 0.5;
    float d = abs(vUv.x - 0.5);
    float a = (1.0 - smoothstep(width * 0.3, width, d)) * (1.0 - along * 0.85);
    vec3 c = mix(vec3(1.0, 0.8, 0.45), vec3(1.0, 0.35, 0.05), along);
    gl_FragColor = vec4(c * 4.0 * a, a);
  }
`;

function MuzzleFlash() {
  const res = useMemo(() => {
    const mk = (fragmentShader: string) =>
      new ShaderMaterial({ vertexShader: flashVertex, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
    // Lưỡi lửa: tấm dài theo +z (hướng nòng), gốc ở đầu nòng.
    const tongue = new PlaneGeometry(0.07, 0.2).translate(0, 0.1, 0).rotateX(Math.PI / 2);
    return { star: mk(starFragment), tongue: mk(tongueFragment), starGeo: new PlaneGeometry(0.16, 0.16), tongueGeo: tongue };
  }, []);
  useEffect(
    () => () => {
      res.star.dispose();
      res.tongue.dispose();
      res.starGeo.dispose();
      res.tongueGeo.dispose();
    },
    [res],
  );
  return (
    <>
      <mesh geometry={res.starGeo} material={res.star} position-z={0.02} renderOrder={20} />
      <mesh geometry={res.tongueGeo} material={res.tongue} renderOrder={20} />
      <mesh geometry={res.tongueGeo} material={res.tongue} rotation-z={Math.PI / 2} renderOrder={20} />
    </>
  );
}

// ---------------------------------------------------------------------------- tâm trên kính phản xạ

/** Chấm đỏ (red dot) hay vòng holo sáng trên kính: ngắm thì nằm đúng giữa màn hình. Ống kính thì tâm vẽ ở HUD. */
function Reticle({ weapon, sight }: { weapon: string; sight: string }) {
  const def = SIGHTS[sight as SightId];
  const res = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: flashVertex,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(3.0, 0.15, 0.1, 1.0); }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    return { m, dot: new CircleGeometry(0.0009, 12), ring: new RingGeometry(0.0055, 0.0064, 32) };
  }, []);
  useEffect(
    () => () => {
      res.m.dispose();
      res.dot.dispose();
      res.ring.dispose();
    },
    [res],
  );
  // Kính toàn ký gắn liền trên SCAR-L (không lắp ống rời): chấm đỏ nổi trên mặt kính của nó.
  if (sight === "builtin")
    return (
      <group position={[0, 0.178, 0.015]} rotation-y={Math.PI}>
        <mesh geometry={res.dot} material={res.m} renderOrder={21} />
        <mesh geometry={res.ring} material={res.m} renderOrder={21} />
      </group>
    );
  if (!def || def.scope) return null;
  const [x, y, z] = railMount(weapon);
  // Tâm nằm ngay mặt sau kính (phía mắt): đặt sau kính thì mặt kính ghi độ sâu che mất tâm, nhìn qua
  // holo chẳng khác gì thước ngắm sắt.
  const lensZ = z + (sight === "holo" ? 0.028 : 0.015);
  return (
    <group position={[x, y + opticHeight(sight), lensZ]} rotation-y={Math.PI}>
      <mesh geometry={res.dot} material={res.m} renderOrder={21} />
      {sight === "holo" && <mesh geometry={res.ring} material={res.m} renderOrder={21} />}
    </group>
  );
}

// ---------------------------------------------------------------------------- hai bàn tay

const sleeveCache = new Map<string, MeshStandardMaterial>();
/** Vải ống tay áo theo bộ rằn ri đang mặc, vẽ đè lên cảnh như súng. */
function sleeveMaterial(outfit: string): MeshStandardMaterial {
  let m = sleeveCache.get(outfit);
  if (m) return m;
  const map = camoTexture(outfit).clone();
  map.repeat.set(0.35, 0.6);
  map.needsUpdate = true;
  m = drawOnTop(new MeshStandardMaterial({ map, roughness: 0.92 }));
  m.userData.detail = "none";
  sleeveCache.set(outfit, m);
  return m;
}

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Đoạn ống (cẳng tay) nối hai điểm trong toạ độ súng. */
function Segment({ from, to, r1, r2, material }: { from: [number, number, number]; to: [number, number, number]; r1: number; r2: number; material: MeshStandardMaterial }) {
  const { geo, pos, quat } = useMemo(() => {
    _a.set(...from);
    _b.set(...to);
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    const g = new CylinderGeometry(r2, r1, len, 10, 1);
    return { geo: g, pos: _a.clone().add(_b).multiplyScalar(0.5), quat: new Quaternion().setFromUnitVectors(_up, _dir.normalize()) };
  }, [from, to, r1, r2]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} position={pos} quaternion={quat} renderOrder={1} />;
}

/** Tay phải nắm tay cầm (toạ độ súng: gốc ở tay cầm, nòng +z, bên phải khẩu súng là -x), ngón trỏ đặt cò, ngón cái vắt sang trái. */
function RightHand() {
  const glove = viewMaterial("glove");
  const knuckle = viewMaterial("knuckle");
  return (
    <group rotation-x={0.28}>
      <mesh material={glove} position={[-0.004, -0.035, -0.022]} renderOrder={1}>
        <boxGeometry args={[0.05, 0.085, 0.04]} />
      </mesh>
      <mesh material={glove} position={[-0.004, -0.045, 0.022]} renderOrder={1}>
        <boxGeometry args={[0.048, 0.06, 0.022]} />
      </mesh>
      <mesh material={knuckle} position={[-0.026, -0.045, 0.0]} renderOrder={1}>
        <boxGeometry args={[0.006, 0.06, 0.03]} />
      </mesh>
      <mesh material={glove} position={[0.0, 0.002, 0.03]} rotation-x={-0.25} renderOrder={1}>
        <boxGeometry args={[0.014, 0.014, 0.05]} />
      </mesh>
      <mesh material={glove} position={[0.024, 0.012, 0.0]} rotation-y={-0.3} renderOrder={1}>
        <capsuleGeometry args={[0.009, 0.04, 4, 8]} />
      </mesh>
    </group>
  );
}

const RIGHT_WRIST: [number, number, number] = [-0.004, -0.07, -0.055];
const RIGHT_ELBOW: [number, number, number] = [-0.13, -0.24, -0.36];

/** Cẳng tay phải từ cổ tay (sau tay cầm) ra sau, xuống dưới bên phải. */
function RightArm({ outfit }: { outfit: string }) {
  return (
    <>
      <Segment from={RIGHT_WRIST} to={[-0.004, -0.06, -0.045]} r1={0.026} r2={0.028} material={viewMaterial("knuckle")} />
      <Segment from={RIGHT_WRIST} to={RIGHT_ELBOW} r1={0.03} r2={0.042} material={sleeveMaterial(outfit)} />
    </>
  );
}

const LEFT_WRIST: [number, number, number] = [0.045, -0.05, -0.05];
const LEFT_ELBOW: [number, number, number] = [0.2, -0.22, -0.36];

/** Tay trái (toạ độ đặt tại chỗ đỡ): lòng tay đỡ dưới, ngón quặp lên sườn phải, ngón cái sườn trái, cẳng tay ra sau. */
function LeftHand({ outfit, pistol }: { outfit: string; pistol: boolean }) {
  const glove = viewMaterial("glove");
  const wrist: [number, number, number] = pistol ? [0.03, -0.06, -0.05] : LEFT_WRIST;
  const elbow: [number, number, number] = pistol ? [0.16, -0.25, -0.34] : LEFT_ELBOW;
  return (
    <>
      <mesh material={glove} position={[0.0, -0.028, 0]} renderOrder={1}>
        <boxGeometry args={[0.05, 0.022, 0.085]} />
      </mesh>
      <mesh material={glove} position={[-0.026, -0.008, 0.005]} renderOrder={1}>
        <boxGeometry args={[0.014, 0.04, 0.075]} />
      </mesh>
      <mesh material={glove} position={[0.026, -0.006, 0.02]} rotation-x={0.3} renderOrder={1}>
        <capsuleGeometry args={[0.008, 0.035, 4, 8]} />
      </mesh>
      <Segment from={wrist} to={elbow} r1={0.03} r2={0.042} material={sleeveMaterial(outfit)} />
      <Segment from={wrist} to={[0.02, -0.035, -0.035]} r1={0.025} r2={0.027} material={viewMaterial("knuckle")} />
    </>
  );
}

/** Bàn tay nắm một món nhỏ (dao, lựu đạn) ở gốc toạ độ (toạ độ camera: −z phía trước), cẳng tay chìa về phía người, xuống dưới. */
function HoldingHand({ outfit }: { outfit: string }) {
  const glove = viewMaterial("glove");
  return (
    <>
      <mesh material={glove} position={[0, -0.012, -0.005]} renderOrder={1}>
        <boxGeometry args={[0.05, 0.05, 0.075]} />
      </mesh>
      <mesh material={glove} position={[0.026, 0.01, 0.012]} rotation-y={-0.4} renderOrder={1}>
        <capsuleGeometry args={[0.009, 0.035, 4, 8]} />
      </mesh>
      <Segment from={[0, -0.025, 0.04]} to={[0.08, -0.22, 0.32]} r1={0.03} r2={0.042} material={sleeveMaterial(outfit)} />
    </>
  );
}
