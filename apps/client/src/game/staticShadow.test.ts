import { describe, expect, it } from "vitest";
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial } from "three";
import { addStaticRoot, bindStaticShadow, installStaticShadows, markDynamic, staticShadowLights, updateStaticShadow } from "./staticShadow.ts";
import { localPosition } from "./shared.ts";

installStaticShadows();

function lights() {
  const sun = new DirectionalLight();
  sun.position.set(30, 60, 10);
  const keep = new DirectionalLight();
  for (const l of [sun, keep]) {
    l.shadow.camera.left = l.shadow.camera.bottom = -45;
    l.shadow.camera.right = l.shadow.camera.top = 45;
  }
  keep.shadow.autoUpdate = false;
  return { sun, keep };
}
const mesh = () => new Mesh(new BoxGeometry(), new MeshBasicMaterial());

describe("bóng tĩnh vẽ sẵn", () => {
  it("nhân bóng tĩnh vào node bóng của mặt trời và gỡ ra được", () => {
    const { sun, keep } = lights();
    const unbind = bindStaticShadow(sun, keep);
    const node = (sun.shadow as unknown as { shadowNode?: { isNode?: boolean } }).shadowNode;
    expect(node?.isNode).toBe(true);
    expect(keep.castShadow).toBe(true);
    expect(keep.shadow.autoUpdate).toBe(false);
    expect(staticShadowLights()?.keep).toBe(keep);
    unbind();
    expect((sun.shadow as unknown as { shadowNode?: unknown }).shadowNode).toBeUndefined();
    expect(staticShadowLights()).toBeNull();
  });

  it("vật tĩnh chỉ vẽ vào bản đồ tĩnh, vật động chỉ vào bản đồ động", () => {
    const { sun, keep } = lights();
    const root = new Group();
    const tree = mesh();
    tree.castShadow = true;
    const falling = mesh();
    falling.castShadow = true;
    const fallingGroup = new Group();
    fallingGroup.add(falling);
    const leaf = mesh(); // không đổ bóng
    root.add(tree, leaf, fallingGroup);
    const player = mesh();
    player.castShadow = true;
    const off = addStaticRoot(root);
    markDynamic(fallingGroup);
    updateStaticShadow(sun, keep, 22, 0);
    expect(keep.shadow.needsUpdate).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);

    sun.shadow.updateMatrices(sun);
    expect([tree.castShadow, falling.castShadow, leaf.castShadow, player.castShadow]).toEqual([false, true, false, true]);
    keep.shadow.updateMatrices(keep);
    expect([tree.castShadow, falling.castShadow, leaf.castShadow, player.castShadow]).toEqual([true, false, false, false]);
    // Ngoài lúc vẽ bóng: trả về đúng giá trị đã gán.
    updateStaticShadow(sun, keep, 22, 0.01);
    expect([tree.castShadow, falling.castShadow, leaf.castShadow, player.castShadow]).toEqual([true, true, false, true]);
    off();
  });

  it("chỉ vẽ lại khi đi xa, mặt trời xoay hay đã lâu", () => {
    const { sun, keep } = lights();
    localPosition.set(0, 0, 0);
    updateStaticShadow(sun, keep, 22, 100);
    keep.shadow.needsUpdate = false;
    updateStaticShadow(sun, keep, 22, 100.5);
    expect(keep.shadow.needsUpdate).toBe(false);
    // Đi 10 m: vẫn trong phần dư.
    localPosition.set(10, 0, 0);
    updateStaticShadow(sun, keep, 22, 101);
    expect(keep.shadow.needsUpdate).toBe(false);
    // Đi 40 m: vẽ lại, tâm mới theo người chơi.
    localPosition.set(40, 0, 0);
    updateStaticShadow(sun, keep, 22, 101.5);
    expect(keep.shadow.needsUpdate).toBe(true);
    expect(keep.target.position.x).toBeCloseTo(40, 0);
    keep.shadow.needsUpdate = false;
    // Mặt trời xoay vài độ.
    sun.position.set(30, 50, 25);
    updateStaticShadow(sun, keep, 22, 102);
    expect(keep.shadow.needsUpdate).toBe(true);
    keep.shadow.needsUpdate = false;
    // Lâu không đổi gì vẫn vẽ lại (nhà sập, vật mới).
    updateStaticShadow(sun, keep, 22, 103);
    expect(keep.shadow.needsUpdate).toBe(false);
    updateStaticShadow(sun, keep, 22, 105);
    expect(keep.shadow.needsUpdate).toBe(true);
  });
});
