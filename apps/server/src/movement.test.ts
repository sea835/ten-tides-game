import { describe, expect, it } from "vitest";
import { CAMP, heightAt } from "@tentides/content";
import { MAX_RUN_SPEED, MAX_SPEED_BOOST } from "@tentides/protocol";
import { isPlausibleMove } from "./movement.ts";

const ground = heightAt(CAMP.x, CAMP.z) + 1;
const from = { x: CAMP.x, y: ground, z: CAMP.z };
const move = (dx: number, dz: number, y = ground) => ({ x: CAMP.x + dx, y, z: CAMP.z + dz, rotY: 0, moving: true, sitting: false });

describe("isPlausibleMove", () => {
  it("nhận bước chạy bình thường", () => {
    expect(isPlausibleMove(from, move(MAX_RUN_SPEED * 0.066, 0), 66)).toBe(true);
  });

  it("nhận đà trượt và nhảy thỏ ở tốc độ tối đa", () => {
    expect(isPlausibleMove(from, move(MAX_RUN_SPEED * MAX_SPEED_BOOST * 0.066, 0), 66)).toBe(true);
  });

  it("từ chối dịch chuyển tức thời", () => {
    expect(isPlausibleMove(from, move(30, 0), 66)).toBe(false);
  });

  it("từ chối vị trí chui xuống đất hoặc ra ngoài map", () => {
    expect(isPlausibleMove(from, move(0, 0, ground - 10), 66)).toBe(false);
    expect(isPlausibleMove(from, { ...move(0, 0), x: 999 }, 10_000)).toBe(false);
  });
});
