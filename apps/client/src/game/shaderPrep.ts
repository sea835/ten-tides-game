import type { Camera, DirectionalLight, Material, Mesh, Object3D, Scene, WebGLRenderer } from "three";
import { detailMesh, detailScene } from "./textures.ts";

// Dịch sẵn shader để khỏi khựng hình giữa trận. three.js dịch shader của một vật liệu ngay lần đầu vẽ nó, và lần
// dịch đó chặn cả khung hình. Trên Windows, Chrome/Edge/Firefox vẽ WebGL qua ANGLE → Direct3D 11: mỗi shader phải dịch
// GLSL → HLSL rồi qua trình biên dịch Direct3D, chậm hơn macOS (Metal) nhiều lần, mỗi lần có thể vài chục đến vài
// trăm ms. Ở đây: vá vân trước (để shader dịch sẵn đúng là bản sẽ dùng), rồi dịch bằng compileAsync (trình duyệt
// dịch song song qua KHR_parallel_shader_compile, không chặn khung hình).

type WithProps = { properties: { get(o: object): { currentProgram?: unknown } } };

function materialsOf(o: Object3D): Material[] {
  const m = (o as { material?: Material | Material[] }).material;
  return !m ? [] : Array.isArray(m) ? m : [m];
}

function needsProgram(gl: WebGLRenderer, m: Material): boolean {
  return (gl as unknown as WithProps).properties.get(m).currentProgram === undefined;
}

/** Vá vân rồi dịch sẵn shader của mọi vật liệu trong cảnh (kể cả vật đang ẩn, ngoài tầm nhìn). */
export function prepareScene(gl: WebGLRenderer, scene: Scene, camera: Camera): Promise<unknown> {
  detailScene(scene);
  return gl.compileAsync(scene, camera).catch(() => {});
}

let busy = false;

/**
 * Một lượt duyệt cảnh: phủ vân cho khối đổi vật liệu giữa chừng, rồi dịch sẵn shader cho vật vừa xuất hiện mà chưa
 * từng được vẽ (đồ rơi mới, người mới vào, xe mới...). Ít vật thì dịch từng vật (gom ánh sáng từ cả cảnh), nhiều thì
 * dịch lại cả cảnh một lượt. Trước đây là hai lượt duyệt riêng (vài nghìn vật mỗi lượt).
 */
export function scanScene(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  const fresh: Object3D[] = [];
  let many = false;
  scene.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) detailMesh(o as Mesh);
    if (busy || many) return;
    if (!(o as { isMesh?: boolean }).isMesh && !(o as { isPoints?: boolean }).isPoints && !(o as { isLine?: boolean }).isLine) return;
    if (materialsOf(o).some((m) => needsProgram(gl, m))) {
      fresh.push(o);
      if (fresh.length > 24) many = true;
    }
  });
  if (busy || fresh.length === 0) return;
  busy = true;
  const done = () => {
    busy = false;
  };
  if (many) void gl.compileAsync(scene, camera).catch(() => {}).finally(done);
  else void Promise.all(fresh.map((o) => gl.compileAsync(o, camera, scene).catch(() => {}))).finally(done);
}

/**
 * Bóng đổ dùng shader riêng (vẽ độ sâu từ phía mặt trời), compileAsync không dịch sẵn được. Mở vùng bóng ra phủ cả bản
 * đồ trong đúng một khung hình để mọi vật đổ bóng đều được vẽ vào bản đồ bóng một lần (shader của chúng dịch luôn lúc
 * đó), rồi trả về hàm khôi phục vùng bóng cũ (gọi ở khung sau). Gọi lúc cảnh còn bị menu che: khựng một lần ở đó thay
 * vì khựng lắt nhắt giữa trận.
 */
export function expandShadows(gl: WebGLRenderer, scene: Scene, reach = 800): (() => void) | null {
  let sun: DirectionalLight | null = null;
  scene.traverse((o) => {
    if (!sun && (o as DirectionalLight).isDirectionalLight && o.castShadow) sun = o as DirectionalLight;
  });
  if (!sun) return null;
  const light: DirectionalLight = sun;
  const cam = light.shadow.camera;
  const saved = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far };
  cam.left = cam.bottom = -reach;
  cam.right = cam.top = reach;
  cam.near = -reach;
  cam.far = reach;
  cam.updateProjectionMatrix();
  gl.shadowMap.needsUpdate = true;
  return () => {
    Object.assign(cam, saved);
    cam.updateProjectionMatrix();
    gl.shadowMap.needsUpdate = true;
  };
}
