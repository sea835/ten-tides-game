import { DirectionalLight, Mesh, Vector3, type Object3D } from "three";
import type { Node } from "three/webgpu";
import { shadow } from "three/tsl";
import { localPosition } from "./shared.ts";

// Bóng tĩnh vẽ sẵn. Mặt đất, cây, nhà, đá chiếm phần lớn lệnh vẽ của bản đồ bóng mà gần như không bao giờ động đậy,
// vậy mà nếu cứ mỗi lần vẽ bóng (20–60 lần mỗi giây) CPU lại phải ra lệnh vẽ lại hết thì rất phí. Giờ có hai bản đồ
// bóng cùng hướng mặt trời:
// - bản đồ tĩnh: chỉ vật thuộc nhánh "tĩnh" (StaticShadowRoot), phủ rộng hơn, chỉ vẽ lại khi người chơi đi xa khỏi
//   tâm, mặt trời xoay đáng kể, hoặc thưa thưa vài giây một lần (nhà sập, cây đổ, vật mới hiện);
// - bản đồ động: như cũ nhưng bỏ qua vật tĩnh, chỉ còn người, xe, trực thăng, đồ rơi...
// Đèn thứ hai (`keep`) chỉ để giữ bản đồ tĩnh: nó KHÔNG nằm trong cảnh nên không phải nguồn sáng nào cả, chỉ là chủ
// của một bản đồ bóng. WebGPURenderer cho đèn đổ bóng đặt node bóng riêng (`light.shadow.shadowNode`): ở mặt trời,
// bóng = bóng động × bóng tĩnh (`bindStaticShadow`); màu đèn (kể cả bóng mây gắn ở `colorNode`) nhân với bóng đó nên
// ánh sáng vẫn tính đúng một lần. GPU lấy mẫu bóng thêm một lần mỗi điểm ảnh, đổi lại CPU bớt hàng trăm lệnh vẽ mỗi
// lần vẽ bóng.

/** Đang vẽ bản đồ bóng nào (đặt ngay trước khi three.js duyệt cảnh cho từng đèn). */
let phase: "idle" | "dynamic" | "static" = "idle";

type Caster = Mesh & { _tenCast?: boolean; _tenStatic?: boolean };

let installed = false;

/**
 * Vá `castShadow` của Mesh (gọi một lần trước khi vẽ bóng lần đầu). Cảnh nào chỉ có một đèn đổ bóng (sảnh chờ, xưởng
 * súng...) thì không ai gọi `bindStaticShadow`, `phase` luôn là "idle" và mọi thứ y như cũ.
 */
export function installStaticShadows() {
  if (installed) return;
  installed = true;
  // Vật tĩnh không vẽ vào bản đồ động, vật động không vẽ vào bản đồ tĩnh. three.js đọc `castShadow` của từng khối
  // lúc duyệt cảnh cho mỗi đèn; ngoài lúc đó trả về đúng giá trị đã gán.
  Object.defineProperty(Mesh.prototype, "castShadow", {
    configurable: true,
    get(this: Caster) {
      if (!this._tenCast) return false;
      if (phase === "dynamic") return !this._tenStatic;
      if (phase === "static") return !!this._tenStatic;
      return true;
    },
    set(this: Caster, v: boolean) {
      this._tenCast = v;
    },
  });
}

/**
 * Gắn bản đồ bóng tĩnh vào mặt trời: bóng nhận được = bóng động của `sun` × bóng tĩnh của `keep`. Gọi một lần ngay
 * sau khi tạo cặp đèn, trước lần dựng shader đầu tiên của vật nhận bóng. `keep` chưa có trong cảnh nên ta tự giữ ma
 * trận và độ rộng bản đồ cho nó (xem `updateStaticShadow`). Trả về hàm gỡ.
 */
export function bindStaticShadow(sun: DirectionalLight, keep: DirectionalLight): () => void {
  keep.castShadow = true;
  keep.shadow.autoUpdate = false;
  hook(sun, "dynamic");
  hook(keep, "static");
  const slot = sun.shadow as unknown as { shadowNode?: unknown };
  slot.shadowNode = (shadow(sun) as unknown as Node<"float">).mul(shadow(keep) as unknown as Node<"float">);
  active = { sun, keep };
  return () => {
    delete slot.shadowNode;
    if (active?.keep === keep) active = null;
  };
}

let active: { sun: DirectionalLight; keep: DirectionalLight } | null = null;

/** Cặp đèn bóng hiện tại (cho dịch sẵn shader: đèn giữ bóng tĩnh không nằm trong cảnh nên không tìm thấy bằng duyệt cảnh). */
export function staticShadowLights() {
  return active;
}

// ------------------------------------------------------------------------------------------------- nhánh tĩnh

const roots = new Set<Object3D>();

/** Đăng ký một nhánh cảnh đứng yên (địa hình, cây, nhà...). Trả về hàm huỷ. */
export function addStaticRoot(o: Object3D): () => void {
  roots.add(o);
  refreshSoon();
  return () => {
    roots.delete(o);
    refreshSoon();
  };
}

/** Đánh dấu vật tĩnh trong các nhánh; nhánh con có `userData.dynamicShadow` (cây đang đổ...) thì bỏ qua. */
function tag(o: Object3D) {
  if (o.userData.dynamicShadow) return;
  (o as Caster)._tenStatic = true;
  const c = o.children;
  for (let i = 0; i < c.length; i++) tag(c[i]!);
}

/** Gỡ đánh dấu (nhánh rời khỏi nhóm tĩnh, cây bắt đầu đổ...). */
function untag(o: Object3D) {
  (o as Caster)._tenStatic = false;
  const c = o.children;
  for (let i = 0; i < c.length; i++) untag(c[i]!);
}

/** Đèn giữ bóng tĩnh bị gỡ (đổi mức đồ hoạ, rời trận): trả mọi vật về bản đồ động. */
export function releaseStaticRoots() {
  for (const r of roots) untag(r);
  force = true;
}

/** Một nhánh trong nhóm tĩnh bắt đầu chuyển động (cây đổ): thôi coi là tĩnh để bóng của nó vẽ theo từng khung. */
export function markDynamic(o: Object3D) {
  o.userData.dynamicShadow = true;
  untag(o);
  refreshSoon();
}

// ------------------------------------------------------------------------------------------------- lịch vẽ lại

let force = true;
/** Vẽ lại bản đồ tĩnh ở khung tới (cảnh vừa đổi đáng kể). */
export function refreshSoon() {
  force = true;
}

const PERIOD = 2.5;
const MIN_GAP = 0.25;
/** Mặt trời xoay quá chừng này (cos góc ≈ 0.4°) thì vẽ lại cho bóng khỏi lệch. */
const TURN = Math.cos((0.4 * Math.PI) / 180);

const UP = new Vector3(0, 1, 0);
const dir = new Vector3();
const lastDir = new Vector3();
const center = new Vector3();
const lastCenter = new Vector3();
const ax = new Vector3();
const ay = new Vector3();
const off = new Vector3();
let last = -1e9;

const hooked = new WeakSet<object>();
function hook(light: DirectionalLight, p: "dynamic" | "static") {
  const s = light.shadow;
  if (hooked.has(s)) return;
  hooked.add(s);
  const orig = s.updateMatrices;
  s.updateMatrices = function (this: typeof s, ...args: Parameters<typeof orig>) {
    phase = p;
    return orig.apply(this, args);
  };
}

/**
 * Gọi mỗi khung trước khi vẽ. `sun`: đèn mặt trời (bóng động, đã nhắm theo người chơi); `keep`: đèn giữ bóng tĩnh;
 * `slack`: người chơi đi xa khỏi tâm bản đồ tĩnh quá chừng này mét (theo mặt phẳng nhìn từ mặt trời) thì vẽ lại.
 */
export function updateStaticShadow(sun: DirectionalLight, keep: DirectionalLight, slack: number, now: number) {
  phase = "idle";
  hook(sun, "dynamic");
  hook(keep, "static");
  dir.subVectors(sun.position, sun.target.position);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  ax.crossVectors(UP, dir);
  if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
  ax.normalize();
  ay.crossVectors(dir, ax);
  off.subVectors(localPosition, lastCenter);
  const drift = Math.max(Math.abs(off.dot(ax)), Math.abs(off.dot(ay)));
  const due = force || drift > slack || dir.dot(lastDir) < TURN || now - last > PERIOD;
  if (!due || now - last < MIN_GAP) return;
  force = false;
  last = now;
  lastDir.copy(dir);
  // Tâm khớp lưới điểm ảnh của bản đồ tĩnh (đổi tâm không làm bóng lăn tăn).
  const cam = keep.shadow.camera;
  const texel = (cam.right - cam.left) / keep.shadow.mapSize.x;
  center.copy(localPosition);
  const a = center.dot(ax);
  const b = center.dot(ay);
  center.addScaledVector(ax, Math.round(a / texel) * texel - a).addScaledVector(ay, Math.round(b / texel) * texel - b);
  lastCenter.copy(center);
  keep.position.copy(center).addScaledVector(dir, 80);
  keep.target.position.copy(center);
  // Đèn giữ bóng nằm ngoài cảnh nên không ai cập nhật ma trận thế giới giùm.
  keep.updateMatrixWorld();
  keep.target.updateMatrixWorld();
  // Vật mới gắn vào nhánh tĩnh được đánh dấu ngay khung này: vào bản đồ tĩnh, rời bản đồ động cùng lúc.
  for (const r of roots) tag(r);
  keep.shadow.needsUpdate = true;
  // Vật vừa đổi nhóm (tĩnh ↔ động) thì bản đồ động cũng phải vẽ lại ngay, kẻo vật còn bóng ở cả hai chỗ.
  sun.shadow.needsUpdate = true;
}
