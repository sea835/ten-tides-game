import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useRapier } from "@react-three/rapier";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
} from "three";
import { bulletPasses, mapOf, type BattleBox, type BoxMat, type World } from "@tentides/content";
import { FENCE_GROUPS } from "./surface.ts";
import { detailed, type DetailKind } from "../textures.ts";

// Công trình của bản đồ Battleground: hàng nghìn khối hộp gom theo chất liệu và theo ô đất TILE mét, mỗi nhóm một
// InstancedMesh (vài chục lệnh vẽ cho cả thành phố), màu riêng từng khối. Chia ô để three.js bỏ qua được phần
// thành phố sau lưng hay ngoài vùng bóng đổ (gom cả bản đồ vào một khối thì khung bao phủ hết, lúc nào cũng vẽ
// hết, kể cả vào bản đồ bóng). Va chạm dựng thẳng bằng API của Rapier (nhanh hơn nhiều so với hàng nghìn
// component va chạm của React).

/** Cạnh ô đất gom khối (mét). */
const TILE = 64;

const MAT: Record<BoxMat, { color: string; kind: DetailKind | "none"; roughness: number; metalness?: number; strength?: number }> = {
  concrete: { color: "#a19d95", kind: "rock", roughness: 0.95, strength: 0.18 },
  plaster: { color: "#d8d2c4", kind: "rock", roughness: 0.9, strength: 0.1 },
  brick: { color: "#ffffff", kind: "none", roughness: 0.92 },
  metal: { color: "#8a8f94", kind: "metal", roughness: 0.55, metalness: 0.35, strength: 0.12 },
  container: { color: "#ffffff", kind: "none", roughness: 0.6, metalness: 0.3 },
  wood: { color: "#8a6a44", kind: "wood", roughness: 0.9 },
  stone: { color: "#9a948a", kind: "cliff", roughness: 1, strength: 0.28 },
  sandbag: { color: "#a8966b", kind: "fabric", roughness: 1, strength: 0.25 },
  road: { color: "#e8e0c0", kind: "none", roughness: 0.7 },
  hull: { color: "#6e1f1a", kind: "metal", roughness: 0.6, metalness: 0.3, strength: 0.2 },
  rust: { color: "#6e4a32", kind: "dirt", roughness: 0.9, metalness: 0.2, strength: 0.35 },
  sign: { color: "#ffffff", kind: "none", roughness: 0.6 },
  fence: { color: "#8a8a8a", kind: "none", roughness: 0.5, metalness: 0.6 },
  roof: { color: "#8c4a3a", kind: "rock", roughness: 0.8, strength: 0.15 },
};

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Vách gạch: hàng gạch so le, mạch vữa sáng. */
function brickTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = "#d9d2c5";
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 9; col++) {
        const x = col * 32 + (row % 2) * 16;
        const shade = 0.8 + Math.random() * 0.35;
        g.fillStyle = `rgb(${Math.round(150 * shade)}, ${Math.round(72 * shade)}, ${Math.round(52 * shade)})`;
        g.fillRect(x + 1, row * 16 + 1, 30, 14);
      }
    }
  });
}

/** Tôn sóng của container: gân dọc sáng tối xen kẽ, vệt gỉ. */
function corrugatedTexture() {
  return canvasTexture(256, 64, (g) => {
    for (let x = 0; x < 256; x++) {
      const v = 190 + Math.round(Math.sin((x / 256) * Math.PI * 32) * 45);
      g.fillStyle = `rgb(${v}, ${v}, ${v})`;
      g.fillRect(x, 0, 1, 64);
    }
    g.globalAlpha = 0.25;
    for (let k = 0; k < 18; k++) {
      g.fillStyle = "#6b3f22";
      g.fillRect(Math.random() * 256, Math.random() * 64, 3 + Math.random() * 10, 2 + Math.random() * 20);
    }
  });
}

/** Mặt đường: nhựa sạn, vạch sơn nằm ở khối riêng. */
function roadTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
  });
}

/** Biển cảnh báo mìn: nền đỏ, đầu lâu, chữ. */
function signTexture() {
  return canvasTexture(
    256,
    160,
    (g) => {
      g.fillStyle = "#c21d17";
      g.fillRect(0, 0, 256, 160);
      g.fillStyle = "#fff";
      g.font = "bold 58px sans-serif";
      g.textAlign = "center";
      g.fillText("☠ MÌN", 128, 78);
      g.font = "bold 26px sans-serif";
      g.fillText("KHÔNG VÀO", 128, 128);
    },
    false,
  );
}

/** Dây thép gai: mấy sợi ngang có gai, nền trong suốt. */
function wireTexture() {
  return canvasTexture(128, 64, (g) => {
    g.clearRect(0, 0, 128, 64);
    g.strokeStyle = "#9a9a9a";
    g.lineWidth = 2;
    for (const y of [8, 24, 40, 56]) {
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y + Math.sin(x * 0.4) * 1.5);
      g.stroke();
      for (let x = 4; x < 128; x += 16) {
        g.beginPath();
        g.moveTo(x - 3, y - 3);
        g.lineTo(x + 3, y + 3);
        g.moveTo(x + 3, y - 3);
        g.lineTo(x - 3, y + 3);
        g.stroke();
      }
    }
  });
}

/**
 * Dán ảnh (gạch, tôn) theo toạ độ thế giới, chiếu ba mặt: khối to nhỏ thế nào gạch cũng đúng cỡ thật, không bị kéo giãn.
 * `scale`: số lần lặp ảnh trên một mét.
 */
function worldMapped(m: MeshStandardMaterial, scale: number) {
  m.customProgramCacheKey = () => `worldmap:${scale}`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWmPos;\nvarying vec3 vWmNormal;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        {
          mat4 wm = modelMatrix;
          #ifdef USE_INSTANCING
            wm = modelMatrix * instanceMatrix;
          #endif
          vWmPos = (wm * vec4(position, 1.0)).xyz;
          // Pháp tuyến gốc của khối (trước khi co giãn) quay theo khối: chọn mặt chiếu đúng.
          vWmNormal = normalize(mat3(wm) * normal / vec3(length(wm[0].xyz), length(wm[1].xyz), length(wm[2].xyz)) );
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWmPos;\nvarying vec3 vWmNormal;")
      .replace(
        "#include <map_fragment>",
        `{
          vec3 n = abs(normalize(vWmNormal));
          vec2 uv = n.x > n.z && n.x > n.y ? vWmPos.zy : (n.z > n.y ? vWmPos.xy : vWmPos.xz);
          vec4 texel = texture2D(map, uv * ${scale.toFixed(3)});
          diffuseColor *= texel;
        }`,
      );
  };
}

function makeMaterial(mat: BoxMat): MeshStandardMaterial {
  const def = MAT[mat];
  // Màu gốc của chất liệu đi theo từng khối (khối có màu riêng thì thay hẳn), không nhân hai lần cho tối đi.
  const m = new MeshStandardMaterial({ color: "#ffffff", roughness: def.roughness, metalness: def.metalness ?? 0 });
  if (mat === "brick") {
    m.map = brickTexture();
    worldMapped(m, 1 / 2.2);
  }
  if (mat === "container") {
    m.map = corrugatedTexture();
    worldMapped(m, 1 / 3);
  }
  if (mat === "road") m.map = roadTexture();
  if (mat === "sign") m.map = signTexture();
  if (mat === "fence") {
    m.map = wireTexture();
    m.alphaTest = 0.4;
    m.side = DoubleSide;
  }
  if (def.kind === "none") m.userData.detail = "none";
  else detailed(m, def.kind, def.strength);
  return m;
}

/** Ma trận của một khối (quay YXZ như server). */
const euler = new Euler();
const quat = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
export function boxQuaternion(b: BattleBox, out = new Quaternion()) {
  euler.set(b.pitch, b.rot, 0, "YXZ");
  return out.setFromEuler(euler);
}

function BoxGroup({ mat, boxes, material, geometry }: { mat: BoxMat; boxes: BattleBox[]; material: MeshStandardMaterial; geometry: BoxGeometry }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new Matrix4();
    const color = new Color();
    boxes.forEach((b, i) => {
      pos.set(b.x, b.y, b.z);
      scl.set(b.w, b.h, b.d);
      matrix.compose(pos, boxQuaternion(b, quat), scl);
      m.setMatrixAt(i, matrix);
      color.set(b.tint ?? MAT[mat].color);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [boxes]);
  const solid = mat !== "road" && mat !== "sign" && mat !== "fence";
  return <instancedMesh ref={mesh} args={[geometry, material, boxes.length]} castShadow={solid} receiveShadow />;
}

/** Va chạm cho mọi khối đặc (một thân cố định, mỗi khối một hộp va chạm), dựng một lần cho mỗi bản đồ. */
function Colliders({ boxes }: { boxes: readonly BattleBox[] }) {
  const { world, rapier } = useRapier();
  useEffect(() => {
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    const q = new Quaternion();
    for (const b of boxes) {
      if (!b.solid) continue;
      boxQuaternion(b, q);
      const desc = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.y, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      // Hàng rào lưới: chặn người, không chặn đạn (xem BULLET_GROUPS).
      if (bulletPasses(b)) desc.setCollisionGroups(FENCE_GROUPS);
      world.createCollider(desc, body);
    }
    return () => {
      // Đổi bản đồ thì cả thế giới vật lý bị huỷ trước; chỉ gỡ khi thân vẫn còn trong thế giới.
      if (world.getRigidBody(body.handle)) world.removeRigidBody(body);
    };
  }, [world, rapier, boxes]);
  return null;
}

export function BattleStructures({ world }: { world: World }) {
  const map = mapOf(world);
  // Mỗi chất liệu một vật liệu và một hình hộp dùng chung cho mọi ô.
  const materials = useMemo(() => new Map<BoxMat, MeshStandardMaterial>(), []);
  const geometry = useMemo(() => {
    const g = new BoxGeometry(1, 1, 1);
    // Ảnh lặp theo kích thước thật của khối (gạch, tôn không bị kéo giãn): UV nhân theo scale trong shader thì
    // phức tạp; ở đây dựa vào vân chi tiết theo toạ độ thế giới, riêng gạch/tôn chấp nhận giãn theo khối.
    g.userData.smooth = true;
    return g;
  }, []);
  useEffect(
    () => () => {
      // Không xoá khỏi danh sách: StrictMode chạy lại effect mà không dựng lại, vật liệu vẫn được dùng tiếp
      // (three.js tự nạp lại lên GPU khi vẽ).
      for (const m of materials.values()) {
        m.map?.dispose();
        m.dispose();
      }
      geometry.dispose();
    },
    [materials, geometry],
  );
  const groups = useMemo(() => {
    const byKey = new Map<string, { mat: BoxMat; boxes: BattleBox[] }>();
    for (const b of map.boxes) {
      const key = `${b.mat}:${Math.floor(b.x / TILE)}:${Math.floor(b.z / TILE)}`;
      const group = byKey.get(key);
      if (group) group.boxes.push(b);
      else byKey.set(key, { mat: b.mat, boxes: [b] });
    }
    return [...byKey.entries()];
  }, [map]);
  const materialOf = (mat: BoxMat) => {
    let m = materials.get(mat);
    if (!m) {
      m = makeMaterial(mat);
      materials.set(mat, m);
    }
    return m;
  };
  return (
    <>
      {groups.map(([key, g]) => (
        <BoxGroup key={key} mat={g.mat} boxes={g.boxes} material={materialOf(g.mat)} geometry={geometry} />
      ))}
      <Colliders boxes={map.boxes} />
    </>
  );
}
