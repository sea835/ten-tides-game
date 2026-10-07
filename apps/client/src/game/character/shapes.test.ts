import { describe, expect, it } from "vitest";
import { Vector3, type BufferAttribute, type BufferGeometry } from "three";
import { body } from "./shapes.ts";

/** Khoảng cách xa nhất từ tâm khớp tới các đỉnh nằm phía `side` của khớp (dọc trục y). */
function reach(g: BufferGeometry, pivot: Vector3, side: 1 | -1): { max: number; min: number } {
  const p = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  let max = 0;
  let min = Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if ((v.y - pivot.y) * side <= 0.002) continue;
    const d = v.distanceTo(pivot);
    max = Math.max(max, d);
    min = Math.min(min, d);
  }
  return { max, min };
}

function finite(g: BufferGeometry) {
  for (const name of ["position", "normal"]) {
    const a = g.attributes[name] as BufferAttribute;
    for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true);
  }
}

describe("khớp liền mạch", () => {
  const B = body();

  it("đùi bịt chỏm cầu ở khớp hông và khớp gối", () => {
    finite(B.thigh);
    // Phần đùi nhô qua khớp hông là chỏm cầu tâm ở khớp: mọi đỉnh cách tâm gần đều (bán kính ống đùi).
    const hip = reach(B.thigh, new Vector3(0, 0, 0), 1);
    expect(hip.max).toBeGreaterThan(0.085);
    expect(hip.max).toBeLessThan(0.1);
    // Qua khớp gối (y = -0.43) cũng là chỏm cầu, không còn mép bịt phẳng.
    const knee = reach(B.thigh, new Vector3(0, -0.43, 0), -1);
    expect(knee.max).toBeGreaterThan(0.05);
    expect(knee.max).toBeLessThan(0.065);
  });

  it("tay áo bịt chỏm cầu ở vai và khuỷu, cẳng tay ở khuỷu", () => {
    finite(B.upperSleeve);
    finite(B.foreSkin);
    const shoulder = reach(B.upperSleeve, new Vector3(0, 0, 0), 1);
    expect(shoulder.max).toBeLessThan(0.065);
    const elbow = reach(B.upperSleeve, new Vector3(0, -0.29, 0), -1);
    expect(elbow.max).toBeLessThan(0.05);
    // Cầu khuỷu (áo) phủ được cả hai đầu chi tại khớp.
    B.elbowSleeve.computeBoundingSphere();
    expect(B.elbowSleeve.boundingSphere!.radius).toBeGreaterThanOrEqual(elbow.max - 0.002);
  });

  it("khối hông có hai cầu khớp hông", () => {
    finite(B.pelvis);
    B.pelvis.computeBoundingBox();
    // Cầu khớp hông (x = ±0.095, bán kính ~0.09) làm hông rộng hơn khối hông trơn (0.166).
    expect(B.pelvis.boundingBox!.max.x).toBeGreaterThan(0.17);
  });
});
