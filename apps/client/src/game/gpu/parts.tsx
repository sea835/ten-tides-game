import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { DynamicDrawUsage, Group, InstancedMesh, type BufferGeometry, type Material, type Object3D } from "three";

// Gộp lệnh vẽ của các khối nhỏ đang chuyển động (thân, tay, chân, mũ, trang bị, súng của từng người lính).
//
// Một nhân vật đầy đủ ghép từ chừng 70 khối, mỗi khối một Mesh, tức một lệnh vẽ CPU phải gửi cho GPU, lượt bóng đổ gửi
// thêm lần nữa. Mười hai người đứng gần là cả nghìn lệnh vẽ mỗi khung hình: máy mạnh vẫn nghẽn ở CPU. Hình và vật liệu
// của các khối vốn dùng chung giữa mọi người, nên ở đây mỗi cặp (hình, vật liệu) chỉ còn MỘT InstancedMesh cho cả cảnh:
// từng khối chỉ là một Object3D rỗng giữ chỗ trong cây (vẫn chuyển động theo xương như cũ), mỗi khung hình ta chép ma
// trận thế giới của nó vào bảng instance. GPU vẽ cùng số tam giác, CPU gửi vài chục lệnh thay vì cả nghìn.
//
// Chỉ bật trong canvas có <PartBatches> (trận đấu); nơi khác (sảnh, xưởng súng, icon) <Part> vẫn là Mesh thường.

interface Batch {
  mesh: InstancedMesh;
  nodes: Object3D[];
}

interface Slot {
  geometry: BufferGeometry;
  material: Material;
  cast: boolean;
  receive: boolean;
  batch: Batch;
}

export class PartStore {
  readonly group = new Group();
  private batches = new Map<string, Batch>();
  private slots = new Map<Object3D, Slot>();

  private batchFor(node: Object3D, geometry: BufferGeometry, material: Material, cast: boolean, receive: boolean): Batch {
    // Loại vân khai báo trên nhóm cha (textures.ts dò ngược lên cây) phải đi theo sang bảng gộp nằm ở gốc cảnh.
    let detail = "";
    for (let p: Object3D | null = node; p && !detail; p = p.parent) detail = (p.userData.detail as string | undefined) ?? "";
    const key = `${geometry.uuid}|${material.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}|${detail}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { mesh: this.makeMesh(geometry, material, cast, receive, 16), nodes: [] };
      if (detail) b.mesh.userData.detail = detail;
      this.batches.set(key, b);
    }
    return b;
  }

  private makeMesh(geometry: BufferGeometry, material: Material, cast: boolean, receive: boolean, capacity: number) {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    // Các khối rải khắp nơi quanh camera: khỏi tính khung bao mỗi khung hình (số khối ít, GPU tự cắt).
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  add(node: Object3D, geometry: BufferGeometry, material: Material, cast: boolean, receive: boolean) {
    this.remove(node);
    const batch = this.batchFor(node, geometry, material, cast, receive);
    batch.nodes.push(node);
    this.slots.set(node, { geometry, material, cast, receive, batch });
  }

  remove(node: Object3D) {
    const slot = this.slots.get(node);
    if (!slot) return;
    this.slots.delete(node);
    const list = slot.batch.nodes;
    const i = list.indexOf(node);
    if (i >= 0) {
      list[i] = list[list.length - 1]!;
      list.pop();
    }
  }

  /** Bật tắt đổ bóng của một khối (chuyển nó sang bảng có hay không đổ bóng). Trả false nếu `node` không phải khối gộp. */
  setCast(node: Object3D, cast: boolean): boolean {
    const slot = this.slots.get(node);
    if (!slot) return false;
    if (slot.cast !== cast) this.add(node, slot.geometry, slot.material, cast, slot.receive);
    return true;
  }

  has(node: Object3D) {
    return this.slots.has(node);
  }

  /** Chép ma trận thế giới của mọi khối đang hiện vào bảng instance. Gọi sau khi cảnh đã tính xong ma trận. */
  sync() {
    for (const b of this.batches.values()) {
      let mesh = b.mesh;
      const nodes = b.nodes;
      if (nodes.length > mesh.instanceMatrix.count) {
        // Hết chỗ: dựng bảng mới to gấp đôi (hiếm, chỉ khi thêm người).
        let capacity = mesh.instanceMatrix.count;
        while (capacity < nodes.length) capacity *= 2;
        const next = this.makeMesh(mesh.geometry, mesh.material as Material, mesh.castShadow, mesh.receiveShadow, capacity);
        next.userData = mesh.userData;
        this.group.remove(mesh);
        mesh.dispose();
        b.mesh = mesh = next;
      }
      const array = mesh.instanceMatrix.array;
      let n = 0;
      outer: for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        for (let p: Object3D | null = node; p; p = p.parent) if (!p.visible) continue outer;
        node.matrixWorld.toArray(array, n * 16);
        n++;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    this.slots.clear();
    this.group.clear();
  }
}

const Ctx = createContext<PartStore | null>(null);

/** Bảng gộp đang chạy của trận đấu (RenderDriver gọi `sync` mỗi khung hình; RemotePlayers bật tắt bóng từng khối). */
export const parts = { current: null as PartStore | null };

/** Bật gộp lệnh vẽ cho mọi <Part> bên trong. Đặt một lần trong cảnh trận đấu. */
export function PartBatches({ children }: { children: ReactNode }) {
  const store = useMemo(() => new PartStore(), []);
  useEffect(() => {
    parts.current = store;
    return () => {
      if (parts.current === store) parts.current = null;
      store.dispose();
    };
  }, [store]);
  return (
    <Ctx.Provider value={store}>
      <primitive object={store.group} />
      {children}
    </Ctx.Provider>
  );
}

/** Tắt gộp cho nhánh con (lớp súng trước mặt vẽ ở lớp riêng, camera riêng: phải là Mesh thật). */
export function PartsOff({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={null}>{children}</Ctx.Provider>;
}

type NodeProps = Omit<ThreeElements["object3D"], "ref" | "children">;

/**
 * Một khối nhỏ dùng chung hình và vật liệu (cùng các prop đặt chỗ của <mesh>: position, rotation, scale, visible...).
 * Trong <PartBatches> là một chỗ giữ chỗ được vẽ gộp; ngoài đó, hoặc với vật liệu trong suốt (cần xếp thứ tự vẽ theo
 * từng vật), là Mesh thường. `solo` ép vẽ riêng.
 */
export function Part({ geometry, material, castShadow = false, receiveShadow = false, solo = false, ...rest }: NodeProps & { geometry: BufferGeometry; material: Material; solo?: boolean }) {
  const store = useContext(Ctx);
  const node = useRef<Object3D>(null);
  const batched = !!store && !solo && !material.transparent;
  useLayoutEffect(() => {
    const o = node.current;
    if (!batched || !o || !store) return;
    store.add(o, geometry, material, castShadow, receiveShadow);
    return () => store.remove(o);
  }, [batched, store, geometry, material, castShadow, receiveShadow]);
  if (!batched) return <mesh geometry={geometry} material={material} castShadow={castShadow} receiveShadow={receiveShadow} {...rest} />;
  return <object3D ref={node} {...rest} />;
}
