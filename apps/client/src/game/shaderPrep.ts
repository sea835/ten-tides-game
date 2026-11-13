import type { Camera, DirectionalLight, Material, Mesh, Object3D, RenderTarget, Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { detailMesh, detailScene } from "./textures.ts";
import { staticShadowLights } from "./staticShadow.ts";

// Dịch sẵn shader để khỏi khựng hình giữa trận. WebGPURenderer dựng node và tạo pipeline của một vật liệu ngay lần
// đầu vẽ nó, và lần đó chặn cả khung hình (WebGPU: createRenderPipeline; nền WebGL 2: dịch GLSL, trên Windows qua
// ANGLE → Direct3D 11 còn chậm hơn nhiều). Ở đây: vá vân trước (để shader dịch sẵn đúng là bản sẽ dùng), rồi dịch
// bằng compileAsync (tạo pipeline bất đồng bộ, không chặn khung hình).
//
// Pipeline phụ thuộc đích vẽ (định dạng, số mẫu MSAA của ảnh đích): có hậu kỳ thì cảnh vẽ vào ảnh của `pass`, không thì
// vẽ ra màn hình; dịch sai đích thì lúc vẽ thật vẫn phải dịch lại. Nên nơi dựng chuỗi vẽ (Game.tsx) khai báo các đích
// thật qua `setPrepTargets`.

/** Một đích vẽ cần dịch sẵn: `target` null là màn hình; `camera` riêng nếu lượt đó dùng camera khác (lớp súng trước mặt). */
export interface PrepTarget {
  target: RenderTarget | null;
  camera?: Camera;
}

let prepTargets: PrepTarget[] = [{ target: null }];

/** Khai báo các đích vẽ thật của khung hình (đổi chuỗi hậu kỳ thì gọi lại; vật liệu sẽ được dịch lại cho đích mới). */
export function setPrepTargets(targets: PrepTarget[]) {
  prepTargets = targets.length ? targets : [{ target: null }];
  compiled = new WeakSet();
  compiledInstanced = new WeakSet();
}

/** Dịch `o` cho mọi đích vẽ. Trạng thái đích chỉ được đọc ở đoạn chạy đồng bộ đầu compileAsync nên đặt rồi trả lại ngay. */
function compile(gl: WebGPURenderer, o: Object3D, camera: Camera, scene?: Scene): Promise<unknown> {
  const prev = gl.getRenderTarget();
  const jobs: Promise<unknown>[] = [];
  const restore = reveal(o);
  try {
    for (const t of prepTargets) {
      gl.setRenderTarget(t.target);
      const cam = t.camera ?? camera;
      jobs.push((scene ? gl.compileAsync(o, cam, scene) : gl.compileAsync(o, cam)).catch(() => {}));
    }
  } finally {
    restore();
    gl.setRenderTarget(prev);
  }
  return Promise.all(jobs);
}

/**
 * compileAsync của WebGPURenderer chỉ dịch vật ĐANG HIỆN và NẰM TRONG KHUNG NHÌN (nó dựng danh sách vẽ như một khung
 * hình thật; `compile` của WebGLRenderer cũ thì duyệt hết). Để nguyên thì mọi thứ sau lưng người chơi, đang ẩn (hiệu
 * ứng nổ, xe chưa tới, đồ chưa rơi) đều bị dịch đúng lúc xuất hiện lần đầu, chặn cả khung hình: quay người lại là
 * khựng. Nên trong đoạn chạy đồng bộ của compileAsync ta cho hiện hết và tắt cắt theo khung nhìn, xong trả lại ngay
 * (chưa có khung hình nào được vẽ ở giữa). Đèn giữ nguyên: bật đèn đang tắt sẽ đổi bộ đèn, shader dịch ra thành bản khác.
 */
function reveal(root: Object3D): () => void {
  const hidden: Object3D[] = [];
  const culled: Object3D[] = [];
  root.traverse((o) => {
    if ((o as { isLight?: boolean }).isLight) return;
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
    if (o.frustumCulled && (o as { isMesh?: boolean }).isMesh) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  return () => {
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  };
}

/** Vật liệu đã gửi đi dịch (WebGPURenderer không cho hỏi vật liệu đã có shader chưa). */
let compiled = new WeakSet<Material>();
/** Cùng vật liệu nhưng vẽ instanced là một shader khác (bảng gộp của gpu/parts.tsx dùng lại vật liệu của Mesh thường). */
let compiledInstanced = new WeakSet<Material>();

function materialsOf(o: Object3D): Material[] {
  const m = (o as { material?: Material | Material[] }).material;
  return !m ? [] : Array.isArray(m) ? m : [m];
}

function needsProgram(m: Material, instanced: boolean): boolean {
  const set = instanced ? compiledInstanced : compiled;
  if (set.has(m)) return false;
  set.add(m);
  return true;
}

/** Vá vân rồi dịch sẵn shader của mọi vật liệu trong cảnh (kể cả vật đang ẩn, ngoài tầm nhìn). */
export function prepareScene(gl: WebGPURenderer, scene: Scene, camera: Camera): Promise<unknown> {
  detailScene(scene);
  return compile(gl, scene, camera);
}

let busy = false;

/**
 * Một lượt duyệt cảnh: phủ vân cho khối đổi vật liệu giữa chừng, rồi dịch sẵn shader cho vật vừa xuất hiện mà chưa
 * từng được vẽ (đồ rơi mới, người mới vào, xe mới...). Ít vật thì dịch từng vật (gom ánh sáng từ cả cảnh), nhiều thì
 * dịch lại cả cảnh một lượt. Trước đây là hai lượt duyệt riêng (vài nghìn vật mỗi lượt).
 */
export function scanScene(gl: WebGPURenderer, scene: Scene, camera: Camera) {
  const fresh: Object3D[] = [];
  let many = false;
  scene.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) detailMesh(o as Mesh);
    if (busy || many) return;
    if (!(o as { isMesh?: boolean }).isMesh && !(o as { isPoints?: boolean }).isPoints && !(o as { isLine?: boolean }).isLine) return;
    const instanced = !!(o as { isInstancedMesh?: boolean }).isInstancedMesh;
    if (materialsOf(o).some((m) => needsProgram(m, instanced))) {
      fresh.push(o);
      if (fresh.length > 24) many = true;
    }
  });
  if (busy || fresh.length === 0) return;
  busy = true;
  const done = () => {
    busy = false;
  };
  if (many) void compile(gl, scene, camera).finally(done);
  else void Promise.all(fresh.map((o) => compile(gl, o, camera, scene))).finally(done);
}

/**
 * Bóng đổ dùng shader riêng (vẽ độ sâu từ phía mặt trời), compileAsync không dịch sẵn được. Mở vùng bóng ra phủ cả bản
 * đồ trong đúng một khung hình để mọi vật đổ bóng đều được vẽ vào bản đồ bóng một lần (shader của chúng dịch luôn lúc
 * đó), rồi trả về hàm khôi phục vùng bóng cũ (gọi ở khung sau). Gọi lúc cảnh còn bị menu che: khựng một lần ở đó thay
 * vì khựng lắt nhắt giữa trận. Cả đèn giữ bóng tĩnh (nằm ngoài cảnh) cũng được mở: vật tĩnh chỉ vẽ ở bản đồ của nó.
 */
export function expandShadows(_gl: WebGPURenderer, scene: Scene, reach = 800): (() => void) | null {
  const lights: DirectionalLight[] = [];
  scene.traverse((o) => {
    if ((o as DirectionalLight).isDirectionalLight && (o as DirectionalLight).castShadow) lights.push(o as DirectionalLight);
  });
  const keep = staticShadowLights()?.keep;
  if (keep && !lights.includes(keep)) lights.push(keep);
  if (!lights.length) return null;
  const saved = lights.map((l) => {
    const cam = l.shadow.camera;
    return { cam, left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far };
  });
  for (const l of lights) {
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = -reach;
    cam.far = reach;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }
  return () => {
    for (const [i, l] of lights.entries()) {
      const { cam, ...box } = saved[i]!;
      Object.assign(cam, box);
      cam.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
    }
  };
}
