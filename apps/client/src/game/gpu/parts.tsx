import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { BatchedMesh, BufferAttribute, Group, Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import { detailMesh } from "../textures.ts";

// Gộp lệnh vẽ của các khối nhỏ đang chuyển động (thân, tay, chân, mũ, trang bị, súng của từng người lính, thân, bánh,
// tháp pháo của xe).
//
// Một nhân vật đầy đủ ghép từ chừng 70 khối, một chiếc xe 15–30 khối; mỗi khối một Mesh, tức một lệnh vẽ CPU phải dựng
// và gửi cho GPU, lượt bóng đổ gửi thêm lần nữa. Mười hai người và mấy chục xe là cả nghìn lệnh vẽ mỗi khung hình: máy
// mạnh vẫn nghẽn ở CPU. Ở đây mọi khối dùng chung một vật liệu nằm trong MỘT BatchedMesh của three.js (nhiều hình khác
// nhau trong một bộ đệm đỉnh, ma trận từng khối trong một ảnh dữ liệu): từng khối chỉ còn là một Object3D rỗng giữ chỗ
// trong cây (vẫn chuyển động theo xương như cũ), mỗi khung hình ta chép ma trận thế giới của nó vào lưới gộp. GPU vẽ
// cùng số tam giác, CPU chỉ còn dựng vài chục lệnh vẽ (mỗi vật liệu một lệnh) thay vì cả nghìn.
//
// Chỉ bật trong canvas có <PartBatches> (trận đấu); nơi khác (sảnh, xưởng súng, icon) <Part> vẫn là Mesh thường.

interface Batch {
  mesh: BatchedMesh;
  /** Hình đã nạp vào lưới gộp: uuid của hình nguồn → mã hình trong BatchedMesh. */
  geometries: Map<string, number>;
  instances: number;
}

interface Slot {
  geometry: BufferGeometry;
  material: Material;
  cast: boolean;
  receive: boolean;
  batch: Batch;
  id: number;
  shown: boolean;
}

/** Hai hình chỉ nằm chung một BatchedMesh được khi cùng bộ thuộc tính đỉnh và cùng có (hay không có) chỉ số. */
function signature(g: BufferGeometry): string {
  const names = Object.keys(g.attributes).sort();
  return (g.index ? "i" : "n") + names.map((n) => `${n}${g.attributes[n]!.itemSize}${g.attributes[n]!.normalized ? "n" : ""}`).join(",");
}

export class PartStore {
  readonly group = new Group();
  private batches = new Map<string, Batch>();
  private slots = new Map<Object3D, Slot>();
  /** Hình nguồn → hình thật sự nạp vào lưới gộp (đã làm mịn pháp tuyến như Mesh thường). */
  private prepared = new WeakMap<BufferGeometry, BufferGeometry>();

  /**
   * Hình thật sự nạp vào lưới gộp: vá vân và làm mịn pháp tuyến đúng như một Mesh thường sẽ được (textures.ts), rồi đưa
   * về cùng một dạng (không chỉ số; vị trí, pháp tuyến, uv) để mọi hình cùng vật liệu nằm chung một BatchedMesh. Hình
   * có thuộc tính riêng (màu đỉnh...) giữ nguyên bộ thuộc tính của nó và nằm lưới riêng.
   */
  private prepare(geometry: BufferGeometry, material: Material, detail: string): BufferGeometry {
    let g = this.prepared.get(geometry);
    if (!g) {
      const probe = new Mesh(geometry, material);
      if (detail) probe.userData.detail = detail;
      detailMesh(probe);
      g = probe.geometry;
      const plain = Object.keys(g.attributes).every((n) => n === "position" || n === "normal" || n === "uv");
      if (plain && g.attributes.position && g.attributes.normal) {
        const flat = g.index ? g.toNonIndexed() : g.clone();
        if (!flat.attributes.uv) flat.setAttribute("uv", new BufferAttribute(new Float32Array(flat.attributes.position!.count * 2), 2));
        flat.userData.smooth = true;
        g = flat;
      }
      this.prepared.set(geometry, g);
    }
    return g;
  }

  private batchFor(node: Object3D, geometry: BufferGeometry, material: Material, cast: boolean, receive: boolean): Batch {
    // Loại vân khai báo trên nhóm cha (textures.ts dò ngược lên cây) phải đi theo sang lưới gộp nằm ở gốc cảnh.
    let detail = "";
    for (let p: Object3D | null = node; p && !detail; p = p.parent) detail = (p.userData.detail as string | undefined) ?? "";
    // Mọi khối gộp đều nhận bóng (chi tiết nhỏ nhận bóng cũng không hại): khỏi tách thêm lưới theo cờ này.
    void receive;
    const key = `${material.uuid}|${cast ? 1 : 0}|${detail}|${signature(geometry)}`;
    let b = this.batches.get(key);
    if (!b) {
      const mesh = new BatchedMesh(64, 16384, 32768, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      // Từng khối tự cắt theo khung nhìn của lượt đang vẽ (cảnh chính, bóng đổ, phản chiếu); cả lưới thì luôn vẽ.
      mesh.perObjectFrustumCulled = true;
      mesh.sortObjects = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.name = "parts";
      if (detail) mesh.userData.detail = detail;
      // Hình bên trong đã mịn sẵn từng cái; làm mịn cả lưới gộp sẽ trộn pháp tuyến giữa các khối khác nhau.
      mesh.geometry.userData.smooth = true;
      this.group.add(mesh);
      b = { mesh, geometries: new Map(), instances: 0 };
      this.batches.set(key, b);
    }
    return b;
  }

  private geometryId(b: Batch, geometry: BufferGeometry): number {
    let id = b.geometries.get(geometry.uuid);
    if (id !== undefined) return id;
    const mesh = b.mesh;
    const vertices = geometry.attributes.position!.count;
    const indices = geometry.index ? geometry.index.count : 0;
    // Hết chỗ chứa đỉnh hay chỉ số: nới gấp đôi (hiếm, chỉ khi một loại khối mới xuất hiện lần đầu).
    if (mesh.unusedVertexCount < vertices || mesh.unusedIndexCount < indices) {
      const usedV = mesh.geometry.attributes.position!.count - mesh.unusedVertexCount;
      const usedI = (mesh.geometry.index ? mesh.geometry.index.count : 0) - mesh.unusedIndexCount;
      mesh.setGeometrySize(Math.max((usedV + vertices) * 2, 16384), Math.max((usedI + indices) * 2, 32768));
      mesh.geometry.userData.smooth = true;
    }
    id = mesh.addGeometry(geometry);
    b.geometries.set(geometry.uuid, id);
    return id;
  }

  add(node: Object3D, geometry: BufferGeometry, material: Material, cast: boolean, receive: boolean) {
    this.remove(node);
    let detail = "";
    for (let p: Object3D | null = node; p && !detail; p = p.parent) detail = (p.userData.detail as string | undefined) ?? "";
    const source = this.prepare(geometry, material, detail);
    const batch = this.batchFor(node, source, material, cast, receive);
    const geometryId = this.geometryId(batch, source);
    if (batch.instances >= batch.mesh.maxInstanceCount) batch.mesh.setInstanceCount(batch.mesh.maxInstanceCount * 2);
    const id = batch.mesh.addInstance(geometryId);
    batch.instances++;
    // Chưa có ma trận: ẩn tới lần `sync` đầu tiên.
    batch.mesh.setVisibleAt(id, false);
    this.slots.set(node, { geometry, material, cast, receive, batch, id, shown: false });
  }

  remove(node: Object3D) {
    const slot = this.slots.get(node);
    if (!slot) return;
    this.slots.delete(node);
    slot.batch.mesh.deleteInstance(slot.id);
    slot.batch.instances--;
  }

  /** Bật tắt đổ bóng của một khối (chuyển nó sang lưới có hay không đổ bóng). Trả false nếu `node` không phải khối gộp. */
  setCast(node: Object3D, cast: boolean): boolean {
    const slot = this.slots.get(node);
    if (!slot) return false;
    if (slot.cast !== cast) this.add(node, slot.geometry, slot.material, cast, slot.receive);
    return true;
  }

  has(node: Object3D) {
    return this.slots.has(node);
  }

  /** Chép ma trận thế giới của mọi khối đang hiện vào lưới gộp. Gọi sau khi cảnh đã tính xong ma trận, trước khi vẽ. */
  sync() {
    outer: for (const [node, slot] of this.slots) {
      const mesh = slot.batch.mesh;
      for (let p: Object3D | null = node; p; p = p.parent) {
        if (!p.visible) {
          if (slot.shown) {
            slot.shown = false;
            mesh.setVisibleAt(slot.id, false);
          }
          continue outer;
        }
      }
      mesh.setMatrixAt(slot.id, node.matrixWorld);
      if (!slot.shown) {
        slot.shown = true;
        mesh.setVisibleAt(slot.id, true);
      }
    }
    for (const b of this.batches.values()) b.mesh.visible = b.instances > 0;
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
