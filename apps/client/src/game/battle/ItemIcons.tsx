import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createRoot, useThree, type ReconcilerRoot } from "@react-three/fiber";
import { ACESFilmicToneMapping, Box3, Group, OrthographicCamera, PMREMGenerator, SRGBColorSpace, Vector3, type Scene, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GunModel, LootModel } from "../GunModel.tsx";

// Ảnh nhỏ cho từng món trong cửa hàng và lời nhắc nhặt đồ: chụp thẳng từ mô hình 3D (GunModel.tsx) bằng MỘT
// trình vẽ phụ chạy ngầm (một ngữ cảnh WebGL riêng, dựng khi cần, bỏ khi hết việc). Mỗi ảnh chụp một lần, lưu
// thành data URL PNG nền trong trong bảng dùng chung cho mọi thành phần.
// Súng và ống ngắm nhìn ngang từ bên phải (nòng chĩa sang phải màn hình), đồ khác nhìn chéo 3/4 từ trên xuống.

const W = 160;
const H = 96;
const DPR = 2;
/** Số ảnh chụp mỗi khung hình (chụp dồn nhiều quá thì giao diện khựng). */
const PER_FRAME = 3;
/** Hết việc bao lâu thì bỏ ngữ cảnh WebGL phụ (ms). */
const IDLE_DISPOSE = 8000;

const icons = new Map<string, string>();
const queue: string[] = [];
const queued = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

// ---------------------------------------------------------------------------- trình vẽ phụ

let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let ready: Promise<void> | null = null;
let pumping = false;
let idleTimer = 0;
let disposeEnv: (() => void) | null = null;

/** Món này là súng (nhìn ngang) hay đồ khác (nhìn chéo). Súng thì dựng thẳng, không nằm như LootModel. */
function isGun(id: string) {
  return !id.includes(":") && !["frag", "smoke", "flash", "mine", "bandage", "medkit", "money"].includes(id);
}

function ensureRoot(): Promise<void> {
  if (ready) return ready;
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  root = createRoot(canvas);
  ready = root
    .configure({
      gl: { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" },
      size: { width: W, height: H, top: 0, left: 0 },
      dpr: DPR,
      frameloop: "never",
      shadows: false,
      // Cùng cách ánh xạ tông màu và không gian màu với cảnh chính (mặc định của R3F).
      onCreated: ({ gl, scene }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.outputColorSpace = SRGBColorSpace;
        gl.setClearColor(0x000000, 0);
        // Môi trường phòng chụp ảnh cho kim loại có chỗ phản chiếu (không có thì thép đen sì).
        const pmrem = new PMREMGenerator(gl);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = env;
        scene.environmentIntensity = 2.2;
        pmrem.dispose();
        disposeEnv = () => env.dispose();
      },
    })
    .then(() => undefined);
  return ready;
}

function disposeRoot() {
  if (!root) return;
  const r = root;
  root = null;
  ready = null;
  disposeEnv?.();
  disposeEnv = null;
  r.unmount();
}

/** Lấy vài món trong hàng đợi, dựng cảnh, chờ cảnh chụp xong rồi lặp lại ở khung hình sau. */
async function pump() {
  if (pumping) return;
  pumping = true;
  clearTimeout(idleTimer);
  try {
    await ensureRoot();
    while (queue.length && root) {
      const batch = queue.splice(0, PER_FRAME);
      await new Promise<void>((done) => {
        root!.render(<Stage key={batch.join("|")} ids={batch} done={done} />);
      });
      for (const id of batch) queued.delete(id);
      notify();
      await new Promise((r) => requestAnimationFrame(r));
    }
  } catch (err) {
    console.warn("[ItemIcons] không chụp được ảnh", err);
    // Hỏng thì bỏ hàng đợi, các ô giữ khung chờ chứ không lặp lỗi mãi.
    for (const id of queue) queued.delete(id);
    queue.length = 0;
  } finally {
    pumping = false;
    if (root) root.render(null);
    idleTimer = window.setTimeout(() => {
      if (!queue.length && !pumping) disposeRoot();
    }, IDLE_DISPOSE);
  }
}

function request(id: string) {
  if (icons.has(id) || queued.has(id)) return;
  queued.add(id);
  queue.push(id);
  void pump();
}

// ---------------------------------------------------------------------------- cảnh chụp

const _box = new Box3();
const _c = new Vector3();
const _v = new Vector3();
const _dir = new Vector3();
/** Súng: nhìn từ bên phải (-x), hơi cao và hơi chếch ra trước. Đồ khác: chéo 3/4 từ trên xuống. */
const SIDE = new Vector3(-1, 0.22, 0.1).normalize();
const THREE_Q = new Vector3(0.85, 0.95, 1.1).normalize();

/** Vừa khung máy ảnh trực giao ôm sát vật (tính theo 8 góc hộp bao nhìn từ máy ảnh), chừa lề nhỏ. */
function frame(cam: OrthographicCamera, box: Box3, dir: Vector3) {
  box.getCenter(_c);
  cam.position.copy(_c).addScaledVector(dir, 6);
  cam.up.set(0, 1, 0);
  cam.lookAt(_c);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    x0 = Math.min(x0, _v.x);
    x1 = Math.max(x1, _v.x);
    y0 = Math.min(y0, _v.y);
    y1 = Math.max(y1, _v.y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let hw = ((x1 - x0) / 2) * 1.1;
  let hh = ((y1 - y0) / 2) * 1.1;
  // Giữ đúng tỉ lệ khung ảnh.
  if (hw / hh > W / H) hh = (hw * H) / W;
  else hw = (hh * W) / H;
  cam.left = cx - hw;
  cam.right = cx + hw;
  cam.top = cy + hh;
  cam.bottom = cy - hh;
  cam.near = 0.01;
  cam.far = 20;
  cam.updateProjectionMatrix();
}

function snap(gl: WebGLRenderer, scene: Scene, cam: OrthographicCamera, obj: Group, dir: Vector3): string {
  obj.updateWorldMatrix(true, true);
  _box.setFromObject(obj);
  if (_box.isEmpty()) return "";
  frame(cam, _box, dir);
  gl.render(scene, cam);
  return gl.domElement.toDataURL("image/png");
}

/** Dựng cùng lúc vài món (ẩn hết), rồi lần lượt hiện từng món, chụp, cất ảnh. */
function Stage({ ids, done }: { ids: string[]; done: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const cam = useRef<OrthographicCamera>(null!);
  const groups = useRef<(Group | null)[]>([]);
  useLayoutEffect(() => {
    const list = groups.current;
    try {
      for (const g of list) if (g) g.visible = false;
      ids.forEach((id, i) => {
        const g = list[i];
        if (!g) return;
        g.visible = true;
        _dir.copy(isGun(id) || id.startsWith("sight:") ? SIDE : THREE_Q);
        const url = snap(gl, scene, cam.current, g, _dir);
        g.visible = false;
        icons.set(id, url);
      });
    } finally {
      // Lỗi giữa chừng vẫn phải báo xong, không thì hàng đợi kẹt mãi.
      done();
    }
  }, [ids, done, gl, scene]);
  return (
    <>
      <orthographicCamera ref={cam}>
        {/* Đèn gắn theo máy ảnh nên mọi góc nhìn đều sáng như nhau: đèn chính trên trái, đèn phụ phải, đèn viền sau. */}
        <directionalLight position={[-3, 4, 2]} intensity={4.5} />
        <directionalLight position={[4, 1, 1]} intensity={1.1} color="#cfe0ff" />
        <directionalLight position={[1, 3, -6]} intensity={1.6} color="#fff1dc" />
      </orthographicCamera>
      <hemisphereLight args={["#e8f0ff", "#4a4238", 1.3]} />
      {ids.map((id, i) => (
        <group key={id} ref={(g) => void (groups.current[i] = g)}>
          {isGun(id) ? <GunModel weaponId={id} /> : <LootModel id={id} />}
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------- dùng trong giao diện

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
const getVersion = () => version;

/** Ảnh (data URL PNG nền trong, 160×96 ×2) của món đồ theo id loot; chưa chụp xong thì undefined. */
export function useItemIcon(id: string): string | undefined {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const url = icons.get(id);
  const missing = url === undefined;
  useEffect(() => {
    if (missing) request(id);
  }, [id, missing]);
  return url || undefined;
}

/** Ô ảnh món đồ: chưa có ảnh thì hiện khung mờ chờ. */
export function ItemIcon({ id, className = "" }: { id: string; className?: string }) {
  const url = useItemIcon(id);
  return url ? <img className={`b-icon ${className}`} src={url} alt="" draggable={false} /> : <span className={`b-icon wait ${className}`} aria-hidden />;
}
