import { describe, expect, it } from "vitest";
import { classifyGpu } from "./platform.ts";

describe("classifyGpu", () => {
  it("nhận ra vẽ bằng CPU", () => {
    expect(classifyGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe("software");
    expect(classifyGpu("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("software");
    expect(classifyGpu("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
  });
  it("card Intel HD/UHD đời cũ là yếu, Iris Xe và Arc thì không", () => {
    expect(classifyGpu("ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("weak");
    expect(classifyGpu("ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)")).toBe("weak");
    expect(classifyGpu("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("ok");
    expect(classifyGpu("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)")).toBe("ok");
  });
  it("card rời, Apple Silicon là ổn; không có tên thì chưa biết", () => {
    expect(classifyGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("ok");
    expect(classifyGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)")).toBe("ok");
    expect(classifyGpu("")).toBe("unknown");
  });
});
