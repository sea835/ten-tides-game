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
import { INTERACT_RADIUS, MAX_RUN_SPEED, MAX_SPEED_BOOST, Messages, type CorrectMessage, type KnockMessage, type MoveMessage } from "@tentides/protocol";
import { myId, type IslandRoom } from "../net.ts";
import { getCameraView } from "./camera.ts";
import { Character, type Motion } from "./Character.tsx";
import { getHud, setHud, setStamina, type NearTarget } from "./hudStore.ts";
import { isTyping, keys, look, smoothView, view } from "./input.ts";
import { getHands } from "./handsStore.ts";
import { getPrivate } from "./privateStore.ts";
import { debugCam, knock, localAim, localEnv, localMotion, localPosition, shake } from "./shared.ts";
import { climbTop, climbTrees, trunkAt, type ClimbTree } from "./Trees.tsx";
import { isBusy, useRoomSnapshot } from "./useRoomSnapshot.ts";
import { PRONE_SPEED, PRONE_TIME, WEAPON } from "@tentides/content";
import { bodies, getBattleHud, hitStopScale, localAvatar, localBody, recoil, seat, setBattleHud, stance } from "./battle/runtime.ts";
import { muzzleOffset } from "./GunModel.tsx";
import { gun, gun as shooterGun } from "./battle/Shooter.tsx";
import { playLand } from "./sound/guns.ts";
import { aimZoom, getSettings } from "./settings.ts";

const WALK_SPEED = 8;
const GRAVITY = 25;
const JUMP_SPEED = 8;
/**
 * Rơi không nhanh hơn mức này (m/s). Không có chặn thì rơi 3 giây là -75 m/s, tức 3,75 m trong
 * một bước solver ở dt=0.05 — vượt quãng `snapToGround(0.4)` nên bám đất nhấp nháy và nhảy mất.
 */
const MAX_FALL = 55;
/**
 * Rời mặt đất rồi bấm Space trong khoảng thời gian này vẫn nhảy được (coyote time).
 * Không có nó, bấm Space hơi trễ 100 ms sau khi bước khỏi mép là rơi thẳng xuống.
 */
const COYOTE_TIME = 0.12;
/** Nước sâu hơn mức này thì phải bơi; nông hơn mức kia thì lại chạm chân xuống đáy mà lội. */
const SWIM_ENTER_DEPTH = 1.35;
const SWIM_EXIT_DEPTH = 1.1;
/** Khi bơi trên mặt nước, chân ở dưới mặt nước chừng này (đầu và vai nhô lên). */
const SWIM_FLOAT = 1.3;
const SWIM_SPEED = 4.2;
const SWIM_SPRINT_SPEED = 6.3;
const DIVE_SPEED = 3.2;
const ASCEND_SPEED = 3.4;
/** Kiệt sức hay quá tải khi bơi: chìm chậm chừng này, đạp nước thì ngoi lên chậm chừng này. */
const SINK_SPEED = 0.8;
const SINK_ASCEND = 1.2;
/** Mang quá tải mà đạp nước ngoi lên thì tốn sức bền chừng này mỗi giây. */
const HEAVY_PADDLE_DRAIN = 9;
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
/** Góc nhìn thứ nhất: mắt cách chân chừng này khi đứng, ngồi, bơi. */
const EYE_HEIGHT = 1.72;
const EYE_HEIGHT_SIT = 1.05;
const EYE_HEIGHT_SWIM = 1.45;
const SEND_INTERVAL = 1 / 15;
const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.4;
const FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
/** Leo cây: ôm cách tâm thân cây chừng này, trèo lên/tuột xuống nhanh chừng này, A/D vòng quanh thân. */
const CLIMB_HUG = 0.72;
const CLIMB_SPEED = 2.2;
const CLIMB_SPRINT_SPEED = 3.4;
const CLIMB_TURN = 2.2;
/** Tốc độ ngang cao nhất khi có đà (trượt, nhảy thỏ); server cũng cho phép tới mức này. */
const TOP_SPEED = MAX_RUN_SPEED * MAX_SPEED_BOOST;
/** Trượt: đang chạy bấm C thì lao tới nhanh hơn chừng này lần, chậm dần, dưới mức kia thì đứng dậy. */
const SLIDE_BOOST = 1.25;
const SLIDE_FRICTION = 9;
const SLIDE_END_SPEED = 9;
/** Khi trượt chỉ bẻ lái được chừng này rad/giây. */
const SLIDE_TURN = 1.2;
const SLIDE_COST = 8;
const SLIDE_COOLDOWN = 0.35;
/** Battleground: trượt từ tốc độ chạy (nhanh hơn chạy một chút), hãm nhanh hơn, dưới mức kia thì thành ngồi xổm. */
const BATTLE_SLIDE_BOOST = 1.3;
const BATTLE_SLIDE_FRICTION = 7.5;
const BATTLE_SLIDE_END = 3.6;
/** Vượt vật cản (bậu cửa sổ, bao cát, tường thấp): cao chừng này (m) mới vượt, mất chừng này giây. */
const VAULT_MIN = 0.45;
const VAULT_MAX = 1.35;
const VAULT_TIME = 0.5;
/**
 * Nhảy thỏ: vừa đáp đất sau một cú nhảy mà bấm Space lại trong chừng này giây (hoặc bấm sớm hơn lúc sắp chạm đất
 * chừng kia giây) thì cú nhảy mới được cộng thêm đà. Giữ Space cho tự nảy hay bấm trễ thì mất đà.
 */
const BHOP_WINDOW = 0.15;
const BHOP_BUFFER = 0.1;
const BHOP_GAIN = 0.1;
const BHOP_MAX = MAX_SPEED_BOOST - 1;
/** Đứng trên đất quá khung giờ trên thì đà mất dần chừng này mỗi giây. */
const BHOP_DECAY = 2;
/** Battleground: tốc độ đi, chạy, ngồi xổm (m/s), camera qua vai (khoảng cách thường, khi ngắm, lệch sang phải). */
const BATTLE_WALK = 5.6;
const BATTLE_RUN = 8.6;
const BATTLE_CROUCH = 3.2;
const BATTLE_CAM_DIST = 3.4;
const BATTLE_CAM_AIM = 1.9;
const BATTLE_SHOULDER = 0.62;
const CAM_HEIGHT_CROUCH = 1.15;
const EYE_HEIGHT_CROUCH = 1.2;
/** Nằm sấp: tâm camera, mắt (góc thứ nhất) thấp sát đất; mắt ở trước chỗ đứng (đầu nằm phía trước). */
const CAM_HEIGHT_PRONE = 0.62;
const EYE_HEIGHT_PRONE = 0.38;
const EYE_FORWARD_PRONE = 0.72;
/**
 * Quán tính khi đi (1/giây, càng lớn càng bám): trên đất tăng tốc, hãm lại; trên không chỉ bẻ lái được chút ít,
 * không bấm gì thì giữ nguyên đà. Số nhỏ hơn = nặng hơn, nên Battleground (mang súng, giáp) quán tính
 * thấp hơn chế độ khám phá: 11/12 so với 13/16.
 */
const GROUND_ACCEL = 11;
const GROUND_BRAKE = 12;
const STORY_ACCEL = 13;
const STORY_BRAKE = 16;
const AIR_CONTROL = 1.4;
/** Battleground: nhảy thấp hơn, rơi nhanh hơn lúc lên (cú nhảy có trọng lượng, không lơ lửng). */
const BATTLE_JUMP = 7;
const BATTLE_GRAVITY_UP = 22;
const BATTLE_GRAVITY_DOWN = 30;
/** Rơi nhanh hơn mức này (m/s) mới tính là cú đáp đất nặng (nhún camera, chậm lại, tiếng dậm). */
const LAND_SOFT = 3.5;
/** Chạy thì nới góc nhìn ra chừng này phần (phóng đại 1.06) để tốc độ đọc được bằng mắt. */
const SPRINT_FOV = 1.06;
/** Vừa đánh hay ném thì quay mặt theo hướng camera chừng này giây. */
const AIM_FACE_MS = 450;

type CharacterController = ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]>;

/**
 * Nhiễu một chiều nội suy mượt giữa hai số ngẫu nhiên, lấy mẫu theo thời gian chứ không theo
 * khung hình. Dùng cho rung màn hình: `Math.random()` mỗi khung làm đặc tính của rung đổi theo
 * FPS (144Hz rung mịn, 30Hz rung đục) dù cường độ giống nhau.
 */
function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  // Nội suy mượt (smoothstep) để không có bậc thang rõ rệt giữa hai mẫu.
  const u = f * f * (3 - 2 * f);
  const h = (n: number) => {
    let x = Math.imul(n ^ seed, 2246822519);
    x ^= x >>> 13;
    x = Math.imul(x, 3266489917);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  return (h(i) + (h(i + 1) - h(i)) * u) * 2 - 1;
}

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
    // Dốc tối đa leo được phải >= dốc nhẹ nhất bắt đầu trượt, nếu không sẽ có dải trống
    // (trước đây 50° leo / 60° trượt) mà người chơi vừa không leo nổi vừa không trượt xuống — đứng yên.
    c.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((50 * Math.PI) / 180);
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
    camDist: CAMERA_DISTANCE,
    /** Đang leo cây nào (server đã đồng ý), cao bao nhiêu trên gốc, đứng ở góc nào quanh thân. */
    climb: null as { tree: ClimbTree; h: number; angle: number } | null,
    wobble: 0,
    /** Vừa bấm Space để nhảy khỏi cây (chờ server đồng ý thôi leo). */
    leap: false,
    /** Đang chìm khi bơi: vì hết hơi, kiệt sức hay mang quá nặng (rỗng là nổi bình thường). */
    sinking: "" as "" | "breath" | "tired" | "heavy",
    /** Đồng hồ riêng (giây) để canh nhịp nhảy thỏ và trượt. */
    clock: 0,
    /** Vừa bấm C (khung hình sau mới biết là trượt hay ngồi). */
    crouchPressed: false,
    /** Đang trượt: hướng và tốc độ còn lại. */
    slide: null as { dir: number; speed: number } | null,
    slideReadyAt: 0,
    /** Đà nhảy thỏ: tốc độ được cộng thêm chừng này phần. */
    hop: 0,
    spaceHeld: false,
    jumpPressAt: -1,
    jumpAt: -1,
    /** Đang bay vì vừa nhảy; đáp đất thì mở khung giờ nhảy thỏ. */
    airJump: false,
    landAt: -1,
    hopReady: false,
    /** Còn bao lâu nữa thì mới mất quyền nhảy sau khi rời đất (coyote time, xem COYOTE_TIME). */
    coyote: 0,
    /** Battleground: đang ngồi xổm; FOV đang dùng (mượt dần khi ngắm). */
    crouching: false,
    /** Battleground: đang nằm sấp (Z), vừa bấm Z. */
    prone: false,
    pronePressed: false,
    /** Độ cao mắt và độ lệch mắt ra trước (góc thứ nhất), đuổi mượt theo tư thế. */
    eye: EYE_HEIGHT,
    eyeFwd: 0,
    fov: 60,
    /** Vận tốc ngang thật (m/s), đuổi theo vận tốc muốn có. */
    vx: 0,
    vz: 0,
    /** Camera nhún khi đáp đất (lò xo) và nhịp bước chân. */
    dip: 0,
    dipV: 0,
    stepPhase: 0,
    /** Số nhịp chân đã đi qua, để tiếng bước chân (Soundscape) khớp đúng với camera bob. */
    steps: 0,
    roll: 0,
    /** Súng dí sát vật cản (0–1). */
    wall: 0,
    /** Đang vượt vật cản: đường cong từ chỗ đứng, qua đỉnh vật cản, xuống phía bên kia (toạ độ tâm thân). */
    vault: null as null | { t: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number },
  });
  const camTarget = useMemo(() => new Vector3(), []);
  const camPos = useMemo(() => new Vector3(), []);
  const camDir = useMemo(() => new Vector3(), []);

  // Dev: dịch chuyển tức thời để thử bản đồ (window.__tentides.teleport(x, y, z)).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __tentides?: Record<string, unknown> };
    w.__tentides ??= {};
    w.__tentides.teleport = (x: number, y: number, z: number) => {
      body.current?.setTranslation({ x, y: y + FEET_OFFSET, z }, true);
      sim.current.vy = 0;
    };
  }, []);

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
        // Đang bơi thì C là giữ để lặn, không phải ngồi. Đang chạy thì C là trượt (khung hình sau quyết định).
        if (!sim.current.swimming) sim.current.crouchPressed = true;
        return;
      }
      // Battleground: Z nằm sấp / đứng dậy.
      if (e.code === "KeyZ" && room.state.mode === "battle") {
        sim.current.pronePressed = true;
        return;
      }
      // Battleground: E là nhặt đồ gần nhất (đứng cạnh xe tăng thì lên xe, đang lái thì xuống xe).
      if (room.state.mode === "battle") {
        if (e.code !== "KeyE") return;
        const near = getBattleHud().nearItem;
        if (seat.id || getBattleHud().nearTank) room.send(Messages.vehicleEnter);
        else if (near) room.send(Messages.pickup, { id: near.key });
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

  /**
   * Thử vượt vật cản phía trước: có vật cản ngay trước mặt ở tầm gối, mặt trên cao 0,45–1,35 m (bậu cửa sổ, bao cát,
   * tường thấp), phía trên còn trống (ô cửa sổ) và phía bên kia có chỗ đặt chân. Trả về đường cong vượt, hoặc null.
   */
  const tryVault = (pos: { x: number; y: number; z: number }, feet: number) => {
    const col = collider.current;
    if (!col) return null;
    const fx = -Math.sin(look.yaw);
    const fz = -Math.cos(look.yaw);
    const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) =>
      physics.castRay(new rapier.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }), len, true, undefined, undefined, col);
    const front = ray(pos.x, feet + 0.55, pos.z, fx, 0, fz, 1.1);
    if (!front) return null;
    const d = front.timeOfImpact;
    // Mặt trên của vật cản: dò từ trên xuống ngay sau mép gần.
    const px = pos.x + fx * (d + 0.12);
    const pz = pos.z + fz * (d + 0.12);
    const topHit = ray(px, feet + VAULT_MAX + 0.3, pz, 0, -1, 0, VAULT_MAX + 0.3);
    if (!topHit) return null;
    const top = feet + VAULT_MAX + 0.3 - topHit.timeOfImpact;
    const h = top - feet;
    if (h < VAULT_MIN || h > VAULT_MAX) return null;
    // Phía trên mặt vật cản phải trống một khoảng (ô cửa sổ): người chui qua được khi khom.
    if (ray(pos.x, top + 0.35, pos.z, fx, 0, fz, d + 1.2)) return null;
    // Bề dày vật cản: đi tới khi mặt trên hết (tối đa 1,2 m); bên kia phải có chỗ đứng.
    let far = 0.3;
    for (; far <= 1.2; far += 0.15) {
      const qx = pos.x + fx * (d + far);
      const qz = pos.z + fz * (d + far);
      const under = ray(qx, top + 0.25, qz, 0, -1, 0, 0.4);
      if (!under) break;
    }
    if (far > 1.2) return null;
    const land = d + far + 0.45;
    const lx = pos.x + fx * land;
    const lz = pos.z + fz * land;
    if (ray(lx, top + 0.3, lz, 0, 1, 0, 1.4)) return null;
    const lift = top + FEET_OFFSET + 0.08;
    return {
      t: 0,
      ax: pos.x,
      ay: pos.y,
      az: pos.z,
      bx: pos.x + fx * (d + far * 0.5),
      by: lift + 0.35,
      bz: pos.z + fz * (d + far * 0.5),
      cx: lx,
      cy: lift,
      cz: lz,
    };
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __tentides?: Record<string, unknown> };
    w.__tentides ??= {};
    w.__tentides.sim = sim.current;
    w.__tentides.keys = keys;
    w.__tentides.tryVault = () => {
      const p = body.current?.translation();
      return p ? tryVault(p, p.y - FEET_OFFSET) : "no body";
    };
  });

  // priority = -1 để chạy TRƯỚC bước vật lý: setNextKinematicTranslation chỉ có tác dụng ở
  // world.step() kế tiếp, nên nếu để cùng priority 0 (Rapier mount trước children) thì avatar
  // mesh chậm đúng một khung so với camera (~0.27m ở 16 m/s). Số âm không kích hoạt chế độ
  // R3F tự render (chỉ priority > 0 mới chiếm quyền render), nên vẫn an toàn.
  useFrame((state, rawDt) => {
    const rb = body.current;
    localBody.current = rb;
    localAvatar.current = avatar.current;
    const col = collider.current;
    const controller = controllerRef.current;
    if (!rb || !col || !controller) return;
    const dt = Math.min(rawDt, 0.05) * hitStopScale();
    const s = sim.current;
    // Đang lái xe tăng: thân đi theo xe, ẩn nhân vật; camera, điều khiển do Vehicles lo.
    if (seat.id) {
      rb.setNextKinematicTranslation({ x: seat.x, y: seat.y + FEET_OFFSET + 0.2, z: seat.z });
      localPosition.set(seat.x, seat.y, seat.z);
      if (avatar.current) avatar.current.visible = false;
      s.crouching = s.prone = false;
      s.pronePressed = s.crouchPressed = false;
      s.slide = null;
      s.vault = null;
      s.vx = s.vz = s.vy = 0;
      stance.aiming = stance.firstPerson = stance.prone = stance.crouching = false;
      stance.moving = stance.sprinting = false;
      localMotion.moving = false;
      return;
    }
    const firstFrame = !s.started;
    if (firstFrame) {
      // Khung hình đầu tiên: đặt camera sau lưng nhân vật, nhìn cùng hướng với nhân vật.
      s.started = true;
      look.yaw = me.rotY + Math.PI;
    }
    // Tạm dừng thì đứng yên; đang trong sự kiện thì đứng yên tại chỗ, người khác vẫn đi tiếp.
    const sheet = room.state.players.get(myId(room));
    const stunned = (sheet?.stun ?? 0) > 0;
    const battle = room.state.mode === "battle";
    // Battleground: gục rồi thì đứng im (camera đi theo người khác).
    const dead = battle && !!sheet && !sheet.alive;
    const frozen = room.state.paused || isBusy(room.state, myId(room)) || stunned || dead;
    const dizzy = sheet?.dizzy ?? 0;
    s.clock += dt;
    // Nhảy thỏ cần bấm Space lại mỗi lần (cả nút cảm ứng, vốn chỉ giữ phím), nên tự bắt lúc vừa nhấn.
    if (keys.has("Space") && !s.spaceHeld && !frozen) s.jumpPressAt = s.clock;
    s.spaceHeld = keys.has("Space");

    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const inputScale = frozen ? 0 : 1;
    // Bấm đi hoặc nhảy khi đang ngồi thì đứng dậy luôn.
    if (s.sitting && !frozen && (forward !== 0 || strafe !== 0 || keys.has("Space"))) s.sitting = false;
    if (s.crouching && (keys.has("Space") || !battle)) s.crouching = false;
    // Nằm sấp (Z): bấm lại Z hay Space thì đứng dậy, C thì chuyển sang ngồi xổm; đang bơi, leo, trượt thì không nằm được.
    // Nằm xuống, đứng dậy mất một lúc (hạ súng, chưa bắn được).
    const setProne = (on: boolean) => {
      if (s.prone === on) return;
      s.prone = on;
      if (on) s.crouching = false;
      const now = performance.now();
      stance.swapAt = now;
      stance.swapDur = PRONE_TIME;
      shooterGun.readyAt = Math.max(shooterGun.readyAt, now + PRONE_TIME * 1000);
      playLand({ x: localPosition.x, y: localPosition.y, z: localPosition.z }, on ? 0.15 : 0.05);
    };
    if (s.pronePressed) {
      s.pronePressed = false;
      if (battle && !frozen && !s.swimming && !s.climb && !s.slide && !s.vault && s.grounded) setProne(!s.prone);
    }
    if (s.prone && (!battle || s.swimming || s.climb || dead)) s.prone = false;
    if (s.prone && !frozen && keys.has("Space")) {
      setProne(false);
      s.jumpPressAt = -1;
    }

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
    const shift = keys.has("ShiftLeft") || keys.has("ShiftRight");
    // Battleground: chạy thì đứng dậy; đang ngắm thì không chạy được; chạy không tốn sức bền.
    if (battle && shift && s.crouching && (forward !== 0 || strafe !== 0)) s.crouching = false;
    if (battle && shift && s.prone && (forward !== 0 || strafe !== 0)) setProne(false);
    const wantsRun = shift && (forward !== 0 || strafe !== 0) && !frozen && !s.prone && !(battle && (stance.aiming || stance.holdFire || s.crouching));
    const running = wantsRun && (battle || (!s.exhausted && s.energy > 0));
    const strength = sheet?.stats.get("strength") ?? 3;
    if (running && !battle) {
      s.energy = Math.max(0, s.energy - (SPRINT_DRAIN_BASE - SPRINT_DRAIN_PER_STRENGTH * strength) * dt);
      if (s.energy === 0) s.exhausted = true;
    } else {
      s.energy += SPRINT_REGEN * (s.sitting ? SIT_REGEN_BONUS : 1) * (s.swimming ? 0.5 : 1) * dt;
      if (s.exhausted && s.energy >= SPRINT_RECOVER_AT) s.exhausted = false;
    }
    s.energy = Math.min(s.energy, sheet?.stamina ?? 100);
    // Quá tải thì đi (và bơi) chậm hơn.
    // Battleground: nhịp chạy như game bắn súng (chậm hơn chế độ khám phá), súng nặng thì chậm hơn, ngắm thì đi chậm.
    const gun = battle && sheet ? WEAPON.get((sheet.kit as unknown as Record<string, string>)[sheet.kit.active] ?? "") : undefined;
    // Đang nằm xuống / đứng dậy thì gần như đứng yên.
    const proneMoving = performance.now() - stance.swapAt < PRONE_TIME * 1000 && stance.swapDur === PRONE_TIME;
    const landSpeed = battle
      ? s.prone
        ? PRONE_SPEED * (stance.aiming ? 0.6 : 1) * (proneMoving ? 0.2 : 1)
        : (running ? BATTLE_RUN : s.crouching ? BATTLE_CROUCH : BATTLE_WALK) * (gun?.speed ?? 1) * (stance.aiming ? 0.68 : 1)
      : running
        ? MAX_RUN_SPEED
        : WALK_SPEED;
    const baseSpeed = s.swimming ? (running ? SWIM_SPRINT_SPEED : SWIM_SPEED) : landSpeed;
    if (s.swimming) s.hop = 0;
    if (battle) s.hop = Math.min(s.hop, 0.3);
    const speed = Math.min(TOP_SPEED, baseSpeed * (1 + s.hop)) * (sheet?.overweight ? OVERWEIGHT_SPEED : 1);

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
    // Vận tốc thật đuổi theo vận tốc muốn có: bước đầu tăng tốc, thả phím thì hãm lại vài bước chứ không đứng khựng;
    // đang bay thì giữ đà (chỉ lái được chút ít), dưới nước thì ì.
    const wantX = moving ? (mx / len) * speed : 0;
    const wantZ = moving ? (mz / len) * speed : 0;
    const inAir = !s.grounded && !s.swimming && !s.climb;
    const rate = s.swimming ? 3.5 : inAir ? (moving ? AIR_CONTROL : 0) : moving ? (battle ? GROUND_ACCEL : STORY_ACCEL) : battle ? GROUND_BRAKE : STORY_BRAKE;
    const follow = 1 - Math.exp(-dt * rate);
    s.vx += (wantX - s.vx) * follow;
    s.vz += (wantZ - s.vz) * follow;
    if (frozen && !inAir) s.vx = s.vz = 0;
    mx = s.vx * dt;
    mz = s.vz * dt;
    if (moving) s.facing = Math.atan2(wantX, wantZ);

    const endSlide = () => {
      s.slide = null;
      s.slideReadyAt = s.clock + SLIDE_COOLDOWN;
    };
    // Đang chạy trên đất mà bấm C thì trượt tới theo đà; không thì ngồi xuống/đứng dậy như cũ.
    if (s.crouchPressed) {
      s.crouchPressed = false;
      if (running && moving && s.grounded && !s.slide && !s.climb && !s.swimming && s.clock >= s.slideReadyAt) {
        const cur = Math.max(speed, Math.hypot(s.vx, s.vz));
        s.slide = { dir: Math.atan2(wantX, wantZ), speed: Math.min(TOP_SPEED, cur * (battle ? BATTLE_SLIDE_BOOST : SLIDE_BOOST)) };
        if (battle) playLand({ x: pos.x, y: feetNow, z: pos.z }, 0.2);
        s.energy = Math.max(0, s.energy - SLIDE_COST);
        s.sitting = false;
      } else if (!s.slide && !s.swimming) {
        if (battle && s.prone) {
          setProne(false);
          s.crouching = true;
        } else if (battle) s.crouching = !s.crouching;
        else s.sitting = !s.sitting;
      }
    }
    if (s.slide && (frozen || s.swimming || s.climb)) s.slide = null;
    if (s.slide) {
      // Trượt: chậm dần, chỉ bẻ lái được chút ít theo hướng đang bấm.
      const sl = s.slide;
      if (moving) {
        const turn = Math.atan2(Math.sin(Math.atan2(mx, mz) - sl.dir), Math.cos(Math.atan2(mx, mz) - sl.dir));
        sl.dir += Math.max(-SLIDE_TURN * dt, Math.min(SLIDE_TURN * dt, turn));
      }
      sl.speed -= (battle ? BATTLE_SLIDE_FRICTION : SLIDE_FRICTION) * dt;
      s.vx = Math.sin(sl.dir) * sl.speed;
      s.vz = Math.cos(sl.dir) * sl.speed;
      mx = s.vx * dt;
      mz = s.vz * dt;
      s.facing = sl.dir;
      if (sl.speed < (battle ? BATTLE_SLIDE_END : SLIDE_END_SPEED)) {
        endSlide();
        // Battleground: trượt hết đà thì ở tư thế ngồi xổm (như game bắn súng), bấm C hay chạy để đứng dậy.
        if (battle) s.crouching = true;
      }
    }
    const sliding = !!s.slide;

    // Bị trói thì chỉ quanh quẩn trong trại (server cũng chặn).
    const tied = room.state.players.get(myId(room))?.tied ?? false;
    const campDist = (x: number, z: number) => Math.hypot(x - room.state.campX, z - room.state.campZ);
    const leavingCamp = tied && campDist(pos.x + mx, pos.z + mz) > CAMP_RADIUS - 0.5 && campDist(pos.x + mx, pos.z + mz) > campDist(pos.x, pos.z);
    if (leavingCamp) {
      mx = 0;
      mz = 0;
      s.vx = s.vz = 0;
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
      s.hop = 0;
      s.airJump = false;
    } else {
      if (s.swimming) {
        // Giữ C (hoặc Ctrl) để lặn, Space để ngoi; thả tay thì nổi dần lên mặt nước. Hết hơi thì bị đẩy lên.
        const surface = WATER_LEVEL - SWIM_FLOAT;
        const diving = !frozen && breath > 0 && (keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight"));
        const ascending = !frozen && keys.has("Space");
        // Kiệt sức hay mang quá nặng thì không nổi được nữa: chìm dần, phải đạp nước (Space) mới ngoi lên nổi,
        // mà mang nặng thì đạp nước cũng tốn sức. Hết hơi thì hoảng loạn, ngoi lên rất chậm.
        const heavy = !!sheet?.overweight;
        const sinking = !diving && (s.exhausted || heavy);
        let target: number;
        if (diving) target = -DIVE_SPEED;
        else if (breath === 0) target = ascending ? SINK_ASCEND : 0.5;
        else if (sinking) target = ascending ? SINK_ASCEND : -SINK_SPEED;
        else if (ascending) target = ASCEND_SPEED;
        else target = feetNow < surface - 0.05 ? 1.6 : (surface - feetNow) * 4;
        if (heavy && ascending) s.energy = Math.max(0, s.energy - HEAVY_PADDLE_DRAIN * dt);
        s.sinking = breath === 0 ? "breath" : sinking ? (heavy ? "heavy" : "tired") : "";
        s.vy += (target - s.vy) * Math.min(1, dt * 6);
        // Không nhô khỏi mặt nước khi đang bơi (trừ khi tới chỗ nông thì lội lên bờ).
        if (feetNow + s.vy * dt > surface + 0.05 && s.vy > 0) s.vy = Math.max(0, (surface + 0.05 - feetNow) / dt);
      } else {
        if (battle && s.grounded && !frozen && !s.vault && !s.slide && keys.has("Space") && s.jumpPressAt === s.clock) {
          // Bấm Space trước bậu cửa sổ, bao cát, tường thấp: chống tay vượt qua thay vì nhảy.
          const v = tryVault(pos, feetNow);
          if (v) {
            s.vault = v;
            s.vx *= 0.4;
            s.vz *= 0.4;
            s.crouching = false;
            stance.swapAt = performance.now();
            stance.swapDur = VAULT_TIME + 0.15;
            playLand({ x: pos.x, y: feetNow, z: pos.z }, 0.1);
          }
        }
        if (s.vault) {
          // Đang vượt: không nhảy.
        } else if ((s.grounded || s.coyote > 0) && !frozen && keys.has("Space") && !stance.prone && performance.now() - stance.swapAt > 150) {
          // Nhảy thỏ: bấm lại đúng lúc vừa đáp đất sau cú nhảy trước thì được thêm đà; nhảy từ cú trượt thì giữ nguyên đà trượt.
          const timed = s.hopReady && s.clock - s.landAt <= BHOP_WINDOW && s.jumpPressAt >= s.landAt - BHOP_BUFFER;
          if (s.slide) {
            s.hop = Math.max(0, Math.min(BHOP_MAX, s.slide.speed / Math.max(1, baseSpeed) - 1));
            endSlide();
          } else if (timed && moving && s.grounded) s.hop = Math.min(BHOP_MAX, s.hop + BHOP_GAIN);
          else s.hop = 0;
          s.vy = battle ? BATTLE_JUMP : JUMP_SPEED;
          s.airJump = true;
          s.jumpAt = s.clock;
          s.hopReady = false;
          // Xoá coyote ngay: Space là kiểu giữ, nếu không xoá thì khung sau vẫn còn quyền nhảy
          // và giữ Space sẽ nhảy liên tục trên không trung.
          s.coyote = 0;
        }
        s.vy -= (battle ? (s.vy > 0 ? BATTLE_GRAVITY_UP : BATTLE_GRAVITY_DOWN) : GRAVITY) * dt;
        // Chặn tốc độ rơi: xem MAX_FALL. Không có chặn thì rơi sâu làm mất bám đất (bước solver
        // dài hơn quãng snapToGround) và cú đáp tay càng lúc càng mạnh vô hạn.
        if (s.vy < -MAX_FALL) s.vy = -MAX_FALL;
      }

      let vaultNext: { x: number; y: number; z: number } | null = null;
      if (s.vault) {
        // Vượt vật cản: đi theo đường cong Bézier (lên đỉnh vật cản rồi xuống phía bên kia), bỏ qua va chạm
        // (người lách qua ô cửa sổ thấp hơn mình). Hết đường thì rơi tự nhiên xuống đất phía bên kia.
        const vt = s.vault;
        vt.t = Math.min(1, vt.t + dt / VAULT_TIME);
        const u = vt.t;
        const w0 = (1 - u) * (1 - u);
        const w1 = 2 * u * (1 - u);
        const w2 = u * u;
        const vx = w0 * vt.ax + w1 * vt.bx + w2 * vt.cx;
        const vy = w0 * vt.ay + w1 * vt.by + w2 * vt.cy;
        const vz = w0 * vt.az + w1 * vt.bz + w2 * vt.cz;
        if (u >= 1) {
          s.vault = null;
          s.vy = 0;
          s.grounded = false;
          s.vx = Math.sin(s.facing) * 2.5;
          s.vz = Math.cos(s.facing) * 2.5;
        }
        vaultNext = { x: vx, y: vy, z: vz };
      }
      // Nằm sấp: đầu, súng ở phía trước chỗ đứng; sát tường thì lùi ra cho khỏi chui vào tường.
      if (s.prone) {
        const fx = -Math.sin(view.yaw);
        const fz = -Math.cos(view.yaw);
        const ahead = physics.castRay(new rapier.Ray({ x: pos.x, y: feetNow + 0.3, z: pos.z }, { x: fx, y: 0, z: fz }), 1.05, true, undefined, undefined, col);
        if (ahead) {
          const push = (1.05 - ahead.timeOfImpact) * Math.min(1, dt * 10);
          mx -= fx * push;
          mz -= fz * push;
        }
      }
      // Bị đánh bật lùi: cộng thêm vận tốc đẩy, giảm dần.
      mx += knock.vx * dt;
      mz += knock.vz * dt;
      controller.computeColliderMovement(col, vaultNext ? { x: 0, y: 0, z: 0 } : { x: mx, y: s.vy * dt, z: mz });
      const delta = controller.computedMovement();
      const wasGrounded = s.grounded;
      const fallSpeed = -s.vy;
      s.grounded = controller.computedGrounded();
      // Đâm vào tường thì mất đà theo hướng đó (không trượt dọc tường với vận tốc cũ khi vừa rời ra).
      if (dt > 0) {
        if (Math.abs(delta.x) < Math.abs(s.vx * dt) * 0.5) s.vx = delta.x / dt;
        if (Math.abs(delta.z) < Math.abs(s.vz * dt) * 0.5) s.vz = delta.z / dt;
      }
      // Đáp đất: rơi càng nhanh càng nhún mạnh, khựng lại một chút, tiếng dậm chân.
      if (!wasGrounded && s.grounded && fallSpeed > LAND_SOFT && !s.swimming) {
        const hard = Math.min(1, (fallSpeed - LAND_SOFT) / 9);
        stance.land = Math.max(stance.land, 0.25 + hard * 0.75);
        s.dipV -= 0.6 + hard * 2.6;
        if (battle) {
          const keep = 1 - 0.45 * hard;
          s.vx *= keep;
          s.vz *= keep;
        }
        playLand({ x: pos.x, y: feetNow, z: pos.z }, hard);
      }
      if (s.grounded && s.vy < 0) s.vy = 0;
      // Coyote time: đang đất thì hồn đầy, rời đất thì đếm ngược (xem COYOTE_TIME).
      s.coyote = s.grounded ? COYOTE_TIME : Math.max(0, s.coyote - dt);
      if (s.airJump && s.grounded && s.clock - s.jumpAt > 0.1) {
        s.airJump = false;
        s.landAt = s.clock;
        s.hopReady = true;
      }
      // Đáp đất rồi mà không nhảy tiếp kịp (hay đứng lại) thì đà mất dần.
      if (s.hop > 0 && s.grounded && !s.airJump && (!moving || s.clock - s.landAt > BHOP_WINDOW)) s.hop = Math.max(0, s.hop - BHOP_DECAY * dt);
      // Trượt qua mép dốc thì rơi xuống, giữ đà trượt.
      if (s.slide && !s.grounded && s.vy < -2) {
        s.hop = Math.max(s.hop, Math.min(BHOP_MAX, s.slide.speed / Math.max(1, baseSpeed) - 1));
        endSlide();
      }

      next = vaultNext ?? { x: pos.x + delta.x, y: pos.y + delta.y, z: pos.z + delta.z };
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

    // Vừa đánh hay ném: quay mặt theo hướng camera cho đòn đi đúng chỗ mình nhắm. Góc thứ nhất thì luôn nhìn theo camera.
    if (!s.climb && (getCameraView() === "first" || (battle && stance.aiming) || performance.now() - localAim.at < AIM_FACE_MS * (battle ? 2 : 1)))
      s.facing = (getCameraView() === "first" || battle ? view.yaw : localAim.yaw) + Math.PI;

    if (avatar.current) {
      const current = avatar.current.rotation.y;
      const diff = Math.atan2(Math.sin(s.facing - current), Math.cos(s.facing - current));
      avatar.current.rotation.y = current + diff * Math.min(1, dt * 12);
    }

    // Camera góc nhìn thứ ba, bám mượt theo nhân vật; hoặc góc nhìn thứ nhất, đặt ngay mắt.
    // Góc camera thật (view) đuổi theo góc chuột (look) cho mượt.
    smoothView(dt, firstFrame);
    const feetY = next.y - FEET_OFFSET;
    // Battleground: ngắm qua ống (phóng đại từ 3 lần) thì nhìn bằng mắt; ngắm thường thì kéo camera sát vai.
    const zoom = battle && stance.aiming ? stance.zoom : 1;
    const scoped = battle && stance.aiming && stance.scoped;
    aimZoom.value = zoom;
    // Ngắm bằng ống ngắm (kể cả red dot, holo) thì luôn nhìn bằng mắt qua kính như súng thật.
    const firstPerson = getCameraView() === "first" || scoped || (battle && stance.aiming && !!stance.sight && !dead);
    stance.firstPerson = firstPerson && !dead;
    if (avatar.current) avatar.current.visible = !firstPerson && !dead;
    const standCam = s.prone ? CAM_HEIGHT_PRONE : s.crouching ? CAM_HEIGHT_CROUCH : CAM_HEIGHT_STAND;
    s.camHeight += ((s.sitting || sliding ? CAM_HEIGHT_SIT : standCam) - s.camHeight) * Math.min(1, dt * (s.prone ? 4 : 6));
    const camDistance = battle ? (stance.aiming ? BATTLE_CAM_AIM : BATTLE_CAM_DIST) : CAMERA_DISTANCE;
    camTarget.set(next.x, feetY + s.camHeight, next.z);
    // Gục rồi thì camera bám theo người mình đang xem.
    const watched = dead ? bodies.get(getBattleHud().spectating) : undefined;
    if (watched) camTarget.set(watched.x, watched.y + 1.6, watched.z);
    if (battle) {
      const shoulder = watched ? 0 : BATTLE_SHOULDER;
      camTarget.x += Math.cos(view.yaw) * shoulder;
      camTarget.z -= Math.sin(view.yaw) * shoulder;
    }
    // FOV theo cài đặt ở CẢ HAI chế độ, thu hẹp khi ngắm, nới ra nhẹ khi chạy.
    // Trước đây story mode cứ để cứng 60 nên đổi cài đặt FOV trong chế độ khám phá không có tác dụng.
    // Phóng đại thật: thu góc nhìn theo tang (ống 4x thì vật to gấp 4 lần), không chia thẳng độ.
    // `running && moving` thay vì `stance.sprinting`: stance được gán ở cuối vòng lặp nên đọc ở
    // đây là giá trị khung trước, tức FOV kick trễ một khung hình.
    const sprinting = running && moving;
    const mag = battle && stance.aiming ? (scoped ? zoom : Math.max(1.15, zoom)) : sprinting ? SPRINT_FOV : 1;
    const baseFov = getSettings().fov;
    const wantFov = mag > 1 ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / mag) * 180) / Math.PI : baseFov;
    s.fov += (wantFov - s.fov) * Math.min(1, dt * (scoped ? 30 : 12));
    const cam = state.camera as import("three").PerspectiveCamera;
    if (Math.abs(cam.fov - s.fov) > 0.01) {
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
    }
    // Nhún camera: lò xo khi đáp đất, nhịp bước chân (góc nhất rõ, góc ba nhẹ), nghiêng nhẹ khi đi ngang.
    s.dipV += (-90 * s.dip - 14 * s.dipV) * dt;
    s.dip += s.dipV * dt;
    stance.land = Math.max(0, stance.land - dt * 2.5);
    const bobK = getSettings().headBob * (battle && stance.aiming ? 0.25 : 1);
    const hSpeed = Math.hypot(s.vx, s.vz);
    stance.speed = hSpeed;
    // Nhịp bước cộng dồn ở đây thay vì ở Soundscape để tiếng chân và camera bob cùng một đồng hồ.
    // Bộ đếm `steps` tăng mỗi lần phase cắt qua mốc π (mỗi chân chạm đất một lần).
    if (s.grounded && !s.swimming && hSpeed > 0.5) {
      const before = Math.floor(s.stepPhase / Math.PI);
      s.stepPhase += dt * (5.2 + hSpeed * 0.9);
      s.steps += Math.floor(s.stepPhase / Math.PI) - before;
    }
    const stepAmt = s.grounded && !s.swimming ? Math.min(1, hSpeed / 7) : 0;
    // Dừng lại thì nội suy nhịp về bội số gần nhất của π cho bằng 0. Trước đây phase đứng yên
    // giữa chừng nên camera "cụp" mỗi lần start/stop và tư thế dừng khác nhau mỗi lần.
    if (stepAmt < 0.05) {
      const near = Math.round(s.stepPhase / Math.PI) * Math.PI;
      s.stepPhase += (near - s.stepPhase) * Math.min(1, dt * 10);
      // Đứng yên hẳn thì chốt phase ngay SAU mốc π (không nằm sát dưới mốc): nhích nhẹ hay gõ WASD
      // liên tục không còn cắt qua π mỗi lần, phải đi đủ nửa nhịp mới tính một bước chân mới.
      if (Math.abs(near - s.stepPhase) < 0.02) s.stepPhase = near + 0.001;
    }
    const bobY = (Math.abs(Math.sin(s.stepPhase)) - 0.5) * 0.045 * stepAmt * bobK;
    const bobX = Math.cos(s.stepPhase) * 0.025 * stepAmt * bobK;
    const side = s.vx * Math.cos(view.yaw) - s.vz * Math.sin(view.yaw);
    s.roll += (-side * 0.0045 * bobK - s.roll) * Math.min(1, dt * 6);
    // Đầu chìm dưới mặt nước (dùng ở cả hai nhánh camera, nên tính trước khi tách).
    const headUnder = feetY + HEAD_HEIGHT < WATER_LEVEL - 0.05;
    if (firstPerson) {
      // Mắt ở trên đỉnh đầu một chút, nhìn theo yaw/pitch (pitch dương là cúi xuống).
      // Mắt (góc thứ nhất) đi mượt theo tư thế: đứng, ngồi xổm, nằm sấp (đầu nằm ở phía trước).
      const eyeWant = s.sitting || sliding ? EYE_HEIGHT_SIT : s.swimming ? EYE_HEIGHT_SWIM : s.prone ? EYE_HEIGHT_PRONE : s.crouching ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
      s.eye += (eyeWant - s.eye) * Math.min(1, dt * (s.prone || eyeWant > s.eye ? 5 : 9));
      s.eyeFwd += ((s.prone ? EYE_FORWARD_PRONE : 0) - s.eyeFwd) * Math.min(1, dt * 5);
      const eyeY = feetY + s.eye;
      state.camera.position.set(next.x + Math.cos(view.yaw) * bobX - Math.sin(view.yaw) * s.eyeFwd, eyeY + s.dip + bobY, next.z - Math.sin(view.yaw) * bobX - Math.cos(view.yaw) * s.eyeFwd);
      camDir.set(-Math.sin(view.yaw) * Math.cos(view.pitch), -Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch));
      camTarget.copy(state.camera.position).add(camDir);
      state.camera.lookAt(camTarget);
      state.camera.rotateZ(s.roll);
    } else {
      camTarget.y += s.dip * 0.6 + bobY * 0.35;
      const horizontal = Math.cos(view.pitch) * camDistance;
      camPos.set(
        camTarget.x + Math.sin(view.yaw) * horizontal,
        camTarget.y + Math.sin(view.pitch) * camDistance,
        camTarget.z + Math.cos(view.yaw) * horizontal,
      );
      // Có vật cản (thân cây, vách hang, sườn đồi) giữa nhân vật và camera thì kéo camera lại gần.
      camDir.subVectors(camPos, camTarget).normalize();
      const hit = physics.castRay(new rapier.Ray(camTarget, camDir), camDistance, true, undefined, undefined, col);
      // Chỉ làm mượt độ dài cần camera (co lại ngay khi vướng, dãn ra từ từ); vị trí camera bám đúng nhân vật
      // từng khung hình, không trễ theo sau nên chạy nhanh không rung.
      const wantDist = hit ? Math.max(battle ? 0.6 : CAMERA_MIN_DISTANCE, hit.timeOfImpact - 0.3) : camDistance;
      s.camDist = firstFrame || wantDist < s.camDist ? wantDist : s.camDist + (wantDist - s.camDist) * Math.min(1, dt * 4);
      camPos.copy(camTarget).addScaledVector(camDir, s.camDist);
      // Đang lặn thì camera được xuống nước theo; bơi trên mặt thì giữ camera trên mặt nước.
      const minCamY = (headUnder ? world.heightAt(camPos.x, camPos.z) : Math.max(world.heightAt(camPos.x, camPos.z), WATER_LEVEL + 0.25)) + 0.5;
      if (camPos.y < minCamY) camPos.y = minCamY;
      if (headUnder && camPos.y > WATER_LEVEL - 0.3) camPos.y = WATER_LEVEL - 0.3;
      state.camera.position.copy(camPos);
      state.camera.lookAt(camTarget);
      state.camera.rotateZ(s.roll * 0.4);
    }
    // Cú hất màn hình khi bắn (lò xo, Shooter đẩy): ngẩng lên, lệch ngang, nghiêng chút rồi về.
    if (battle && !dead) {
      state.camera.rotateX(recoil.punchPitch);
      state.camera.rotateY(recoil.punchYaw);
      state.camera.rotateZ(recoil.punchRoll);
    }
    // Rung màn hình (bị đánh, cây đổ sát bên) và nghiêng ngả khi chóng mặt.
    // Rung: lấy mẫu nhiễu theo THỜI GIAN chứ không theo khung hình. Math.random() mỗi khung cho
    // cùng một cường độ lại rung mịn ở 144Hz và rung đục ở 30Hz — tính chất của rung đổi theo FPS.
    if (shake.amount > 0.005) {
      const a = shake.amount * 0.35;
      const t = state.clock.elapsedTime;
      state.camera.position.x += valueNoise(t * 34, 1) * a;
      state.camera.position.y += valueNoise(t * 31, 2) * a;
      state.camera.position.z += valueNoise(t * 37, 3) * a * 0.6;
      // Rung xoay đọc được rõ hơn rung tịnh tiến (mắt nhạy với góc hơn với dịch chuyển).
      state.camera.rotateZ(valueNoise(t * 29, 4) * a * 0.5);
      state.camera.rotateX(valueNoise(t * 26, 5) * a * 0.3);
      shake.amount *= Math.exp(-dt * 7);
    } else shake.amount = 0;
    if (dizzy > 0) state.camera.rotateZ(Math.sin(s.wobble * 1.7) * 0.14 * Math.min(1, dizzy));
    if (import.meta.env.DEV && debugCam.enabled) {
      state.camera.position.copy(debugCam.position);
      state.camera.lookAt(debugCam.target);
    }

    localPosition.set(next.x, feetY, next.z);
    // Battleground: chân bước theo tốc độ thật (còn trôi theo quán tính thì vẫn bước, đứng hẳn mới dừng).
    localMotion.moving = s.climb ? climbMoving : battle ? hSpeed > 0.35 || sliding : moving || sliding;
    // Cấp tốc độ thật cho cả hai chế độ: Character dùng nó để mỗi bước đúng một sải
    // (chân không trượt). Trước đây chỉ Battleground có, nên ở chế độ khám phá nhịp chân
    // rơi về hằng số 12.5–17 rad/s trong khi đang đi 8–16 m/s ⇒ trượt chân 65–76%.
    localMotion.speed = hSpeed;
    // Tiếng bước chân bám theo bộ đếm nhịp (xem localMotion.steps) thay vì timer riêng.
    // Chỉ kêu khi đi thật (> 0.8 m/s); nhịp cắt qua π lúc đang nhích chậm vẫn được "tiêu" im lặng
    // (localMotion.steps vẫn cập nhật) để khỏi dồn lại kêu một phát khi bắt đầu đi.
    const stepping = s.grounded && !s.swimming && hSpeed > 0.8;
    localMotion.stepHit = stepping && s.steps !== localMotion.steps;
    localMotion.groundStep = stepping;
    localMotion.steps = s.steps;
    localMotion.crouching = s.crouching || !!s.vault;
    localMotion.prone = s.prone;
    localMotion.running = (moving && running) || sliding;
    localMotion.sliding = sliding;
    localMotion.climbing = !!s.climb;
    localMotion.sitting = s.sitting;
    localMotion.swimming = s.swimming;
    localMotion.aiming = battle && stance.aiming;
    stance.crouching = s.crouching;
    stance.prone = s.prone;
    stance.moving = moving || sliding;
    stance.sprinting = running && moving;
    stance.airborne = !s.grounded && !s.swimming;
    // Góc ngắm lên xuống theo hướng camera (dương là ngẩng lên).
    state.camera.getWorldDirection(camDir);
    localMotion.aimPitch = Math.asin(Math.max(-1, Math.min(1, camDir.y)));
    // Nòng súng sắp chạm vật cản (tường, cột, cây, xe...): dựng súng lên cho khỏi xuyên, gỡ ra thì hạ về.
    let wallTarget = 0;
    if (battle && gun && !dead && !s.swimming && !s.climb) {
      const reach = gun.class === "pistol" ? 0.62 : 0.4 + muzzleOffset(gun.id)[2];
      if (firstPerson) camTarget.copy(state.camera.position);
      else if (s.prone) camTarget.set(next.x - Math.sin(view.yaw) * 0.6, feetY + 0.36, next.z - Math.cos(view.yaw) * 0.6);
      else camTarget.set(next.x + Math.cos(view.yaw) * 0.18, feetY + (s.crouching ? 1.05 : 1.42), next.z - Math.sin(view.yaw) * 0.18);
      const block = physics.castRayAndGetNormal(new rapier.Ray(camTarget, camDir), reach + 0.15, true, undefined, undefined, col);
      // Nhìn xuống sàn, lên trần thì không tính (chỉ mặt đứng như tường, cột, thân cây).
      if (block && Math.abs(block.normal.y) < 0.6) wallTarget = Math.min(1, Math.max(0, (reach + 0.15 - block.timeOfImpact) / (reach * 0.55)));
    }
    s.wall += (wallTarget - s.wall) * Math.min(1, dt * (wallTarget > s.wall ? 14 : 7));
    stance.wall = s.wall;
    localMotion.wall = s.wall;
    const inside = world.structureAt(next.x, next.z);
    const maxDepth = inside ? Math.max(1, ...inside.structure.depth) : 1;
    const indoorTarget = inside ? 0.45 + 0.55 * (inside.depth / maxDepth) : 0;
    localEnv.indoor += (indoorTarget - localEnv.indoor) * Math.min(1, dt * 3);
    localEnv.underwater = state.camera.position.y < WATER_LEVEL - 0.05;
    // Không copy cả mảng mỗi khung hình chỉ để chạy hai phép includes (trước đây là
    // `[...sheet.items]` + 2 lần quét tuyến tính, ở mọi khung hình).
    const items = sheet?.items;
    localEnv.light = !!items && (items.includes("lantern") || items.includes("torch"));

    if (battle) {
      // Đồ gần nhất nhặt được.
      // Đồ để nhặt: trong tầm với, ưu tiên món đang nhìn vào (tâm ngắm chĩa tới), không chỉ món gần chân nhất —
      // đồ rơi thường nằm thành đống (súng, hộp đạn, băng gạc cạnh nhau), nhìn món nào nhặt món ấy.
      let near: { key: string; itemId: string } | null = null;
      let bestScore = Infinity;
      const eyeX = state.camera.position.x;
      const eyeY = state.camera.position.y;
      const eyeZ = state.camera.position.z;
      if (!dead)
        for (const [key, g] of room.state.groundItems) {
          const d = Math.hypot(g.x - next.x, g.z - next.z);
          if (d > 2.6 || Math.abs(g.y - feetY) > 2.2) continue;
          const tx = g.x - eyeX;
          const ty = g.y + 0.1 - eyeY;
          const tz = g.z - eyeZ;
          const tl = Math.hypot(tx, ty, tz) || 1;
          const facing = (tx * camDir.x + ty * camDir.y + tz * camDir.z) / tl;
          const score = d * 0.35 + (1 - facing) * 3;
          if (score < bestScore) {
            bestScore = score;
            near = { key, itemId: g.itemId };
          }
        }
      const cur = getBattleHud().nearItem;
      if (near?.key !== cur?.key) setBattleHud({ nearItem: near });
      setHud({ region: world.regionAt(next.x, next.z), swimming: s.swimming, underwater: headUnder });
    } else {
    const anchor = frozen ? null : nearestOpenAnchor(room, next.x, next.z);
    setHud({
      zone: world.zoneAt(next.x, next.z),
      region: world.regionAt(next.x, next.z),
      swimming: s.swimming,
      underwater: headUnder,
      nearAnchor: anchor,
      nearTarget: frozen || anchor || s.climb ? null : nearestTarget(room, world, next.x, feetY, next.z),
      climbing: !!s.climb,
      sinking: s.swimming ? s.sinking : "",
      victim: frozen || s.climb ? null : nearestVictim(room, next.x, feetY, next.z),
      giveTo: frozen || s.climb || !getHands() ? null : nearestPlayer(room, next.x, feetY, next.z, GIVE_RADIUS),
      atDigSite: !frozen && atDigSite(room, next.x, next.z),
      sitting: s.sitting,
      hidden: s.sitting && world.inTallGrass(next.x, next.z),
    });
    }
    // Sức bền nằm ở kho riêng (useStamina): hồi 12 đơn vị/giây nên gộp vào setHud sẽ khiến
    // mọi thành phần useHud() render lại ~12 lần/giây vĩnh viễn.
    setStamina(s.energy);

    s.sendTimer += dt;
    if (s.sendTimer >= SEND_INTERVAL) {
      // Trừ chứ không đặt 0: đặt 0 làm dồn sai số cố định ~4% trên tần số gửi 15Hz.
      s.sendTimer -= SEND_INTERVAL;
      const msg: MoveMessage = { x: next.x, y: feetY, z: next.z, rotY: s.facing, moving: s.climb ? climbMoving : battle ? hSpeed > 0.35 || sliding : moving || sliding, sitting: s.sitting, swimming: s.swimming };
      if (battle) {
        msg.crouching = s.crouching;
        msg.prone = s.prone;
        msg.aiming = stance.aiming;
        msg.aimPitch = localMotion.aimPitch;
      }
      const key = `${msg.x.toFixed(2)},${msg.y.toFixed(2)},${msg.z.toFixed(2)},${msg.rotY.toFixed(2)},${msg.moving},${s.sitting},${s.swimming},${s.crouching},${s.prone},${msg.aiming},${(msg.aimPitch ?? 0).toFixed(2)}`;
      if (key !== s.lastSent) {
        s.lastSent = key;
        room.send(Messages.move, msg);
      }
    }
  }, -1);

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[spawn.x, spawn.y + FEET_OFFSET, spawn.z]}>
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      <group position-y={-FEET_OFFSET}>
        {room.state.mode === "battle" ? (
          <BattleLook room={room}>{({ skin, ...look }) => <Character ref={avatar} color={me.color} {...look} gunSkin={skin} motion={() => readLocalMotion(room)} />}</BattleLook>
        ) : (
          <Carrier room={room}>{(carrying, held) => <Character ref={avatar} color={me.color} carrying={carrying} held={held} motion={() => readLocalMotion(room)} />}</Carrier>
        )}
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
  if (room.state.mode === "battle") {
    const now = performance.now();
    const def = WEAPON.get(gun.weapon);
    merged.reload = def && gun.reloadUntil > now ? 1 - (gun.reloadUntil - now) / (gun.reloadDur * 1000) : undefined;
    const k = Math.min(1, (now - stance.swapAt) / (stance.swapDur * 1000));
    merged.swap = 1 - k * k * (3 - 2 * k);
    merged.cook = stance.cookAt > 0;
  }
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
  // `discovered` đã là mảng; quét trực tiếp còn nhanh hơn dựng Set mới ở mỗi khung hình
  // (hàm này chạy 60 lần/giây).
  const found = state.discovered;
  for (const p of world.pois) {
    if (found.includes(p.id) || (p.day !== 0 && p.day !== state.day) || Math.abs(p.y - y) > 3.5) continue;
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
    if (page.day !== state.day || found.includes(page.id) || Math.abs(page.y - y) > 3) continue;
    if (Math.hypot(page.x - x, page.z - z) <= INTERACT_RADIUS) return { id: page.id, kind: "page", label: "Nhặt trang nhật ký" };
  }
  // Cạnh lửa trại: đang cầm đồ ăn thì nướng hoặc góp vào kho; sáng sớm hay ban ngày thì nhổ trại vác đi chỗ khác.
  if (!state.campPacked && Math.hypot(state.campX - x, state.campZ - z) <= CAMPFIRE_REACH) {
    const held = getPrivate()?.bag.find((b) => b.uid === getHands());
    const def = held && content.items.get(held.itemId);
    if (def?.hull) return { id: "campfire", kind: "campfire", label: `Đóng ${def.name.toLowerCase()} vào thuyền (+${def.hull} thân thuyền)` };
    if (def?.cook) return { id: "campfire", kind: "campfire", label: `Nướng ${def.name.toLowerCase()}` };
    if (def?.ration) return { id: "campfire", kind: "campfire", label: `Góp ${def.name.toLowerCase()} vào kho (+${def.ration} khẩu phần)` };
    if (state.phase !== "dusk" && Math.hypot(state.campX - x, state.campZ - z) <= 3.5) return { id: "camp", kind: "camp", label: "Nhổ lửa trại mang đi" };
  }
  // Cây đủ lớn: leo lên.
  bestDist = CLIMB_REACH;
  for (const t of climbTrees(room, world, true)) {
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

/** Đứng cách nhau chừng này thì trao tay được (server kiểm tra lại). */
const GIVE_RADIUS = 2.5;

/** Người còn sống gần nhất trong bán kính (để trao đồ). */
function nearestPlayer(room: IslandRoom, x: number, y: number, z: number, radius: number): { id: string; name: string } | null {
  if (!["dawn", "explore", "dusk"].includes(room.state.phase)) return null;
  const me = myId(room);
  let best: { id: string; name: string } | null = null;
  let bestDist = radius;
  for (const [id, p] of room.state.players) {
    if (id === me || !p.alive || !p.connected || Math.abs(p.y - y) > 2) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestDist) {
      best = { id, name: p.name };
      bestDist = d;
    }
  }
  return best;
}

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
/** Battleground: súng đang cầm, áo ngụy trang, giáp, mũ của mình. */
function BattleLook({ room, children }: { room: IslandRoom; children: (look: { weapon: string; sight: string; atts: string; skin: string; throwable: string; knife: boolean; outfit: string; armor: number; helmet: number }) => ReactNode }) {
  const look = useRoomSnapshot(room, (s) => {
    const k = s.players.get(myId(room))?.kit;
    if (!k) return { weapon: "", sight: "", atts: "", skin: "", throwable: "", knife: false, outfit: "woodland", armor: 0, helmet: 0 };
    const slot = k.active;
    const gunSlot = slot === "primary1" || slot === "primary2" || slot === "pistol";
    const weapon = gunSlot ? k[slot] : "";
    const me = s.players.get(myId(room));
    return {
      weapon,
      sight: slot === "primary1" ? k.sight1 : slot === "primary2" ? k.sight2 : slot === "pistol" ? k.sightP : "",
      atts: slot === "primary1" ? k.att1 : slot === "primary2" ? k.att2 : slot === "pistol" ? k.attP : "",
      skin: weapon ? (me?.skins.get(weapon) ?? "") : "",
      throwable: ["frag", "smoke", "flash", "mine"].includes(slot) ? slot : "",
      knife: slot === "",
      outfit: k.outfit,
      armor: k.armor,
      helmet: k.helmet,
    };
  });
  return <>{children(look)}</>;
}

function Carrier({ room, children }: { room: IslandRoom; children: (carrying: boolean, held: string) => ReactNode }) {
  const carrying = useRoomSnapshot(room, (s) => s.treasureCarrier === myId(room) && !s.treasureSafe);
  const held = useRoomSnapshot(room, (s) => s.players.get(myId(room))?.held ?? "");
  return <>{children(carrying, held)}</>;
}
