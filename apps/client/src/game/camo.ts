import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { mulberry32 } from "./nature.ts";

// Vải rằn ri vẽ bằng canvas lúc chạy (không tải file): rừng rậm, sa mạc, thành phố, kỹ thuật số, tuyết, ghillie.
// Mọi hoạ tiết lặp liền mép (vẽ mỗi mảng chín lần lệch một ô) để quấn quanh tay chân không thấy đường nối.

const S = 256;

/** Một mảng loang: đa giác mép gợn sóng, bán kính dao động theo vài sóng sin ngẫu nhiên. */
function blob(g: CanvasRenderingContext2D, rand: () => number, x: number, y: number, r: number, stretch: number, angle: number, fill: string) {
  const k1 = 2 + Math.floor(rand() * 3);
  const k2 = 5 + Math.floor(rand() * 4);
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  const pts: [number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rr = r * (1 + 0.3 * Math.sin(a * k1 + p1) + 0.14 * Math.sin(a * k2 + p2) + (rand() - 0.5) * 0.1);
    const lx = Math.cos(a) * rr * stretch;
    const ly = Math.sin(a) * rr;
    pts.push([lx * Math.cos(angle) - ly * Math.sin(angle), lx * Math.sin(angle) + ly * Math.cos(angle)]);
  }
  g.fillStyle = fill;
  // Vẽ ở cả chín ô kề nhau để mảng tràn mép này thì hiện lại ở mép kia.
  for (let ox = -S; ox <= S; ox += S) {
    for (let oy = -S; oy <= S; oy += S) {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(x + ox + px, y + oy + py) : g.moveTo(x + ox + px, y + oy + py)));
      g.closePath();
      g.fill();
    }
  }
}

/** Rắc hạt nhỏ sáng tối để vải trông có sợi dệt. */
function grain(g: CanvasRenderingContext2D, rand: () => number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
    g.fillRect(Math.floor(rand() * S), Math.floor(rand() * S), 1 + Math.floor(rand() * 2), 1);
  }
}

/**
 * Sợi dệt: hàng sợi ngang dọc sáng tối xen kẽ rất nhẹ (vải chéo), vài vệt sợi to nhỏ không đều. Phủ lên mọi tấm vải
 * để nhìn gần không phẳng lì như nhựa.
 */
function weave(g: CanvasRenderingContext2D, rand: () => number, alpha: number) {
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = `rgba(0,0,0,${alpha * (0.6 + rand() * 0.4)})`;
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    g.fillStyle = `rgba(255,255,255,${alpha * 0.5 * (0.5 + rand() * 0.5)})`;
    g.fillRect(x, 0, 1, S);
  }
  // Sợi chéo (vải twill): vạch chéo mảnh lặp liền mép.
  g.strokeStyle = `rgba(0,0,0,${alpha * 0.6})`;
  g.lineWidth = 1;
  for (let k = -S; k < S; k += 4) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + S, S);
    g.stroke();
  }
  // Sợi to, sợi xù.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha * 1.4})` : `rgba(255,255,255,${alpha})`;
    const horizontal = rand() < 0.5;
    const len = 4 + rand() * 14;
    g.fillRect(Math.floor(rand() * S), Math.floor(rand() * S), horizontal ? len : 1, horizontal ? 1 : len);
  }
}

/** Rằn ri mảng loang: nền và từng lớp màu, mỗi lớp nhiều mảng to nhỏ, kéo dài theo một hướng. */
function blobs(g: CanvasRenderingContext2D, rand: () => number, base: string, layers: { color: string; n: number; r: number }[]) {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (const layer of layers) {
    for (let i = 0; i < layer.n; i++) {
      blob(g, rand, rand() * S, rand() * S, layer.r * (0.6 + rand() * 0.8), 1.3 + rand() * 1.1, -0.5 + (rand() - 0.5) * 0.8, layer.color);
    }
  }
}

/** Kỹ thuật số (MARPAT): ô vuông nhỏ gom thành mảng theo nhiễu, vài màu chồng nhau. */
function pixels(g: CanvasRenderingContext2D, rand: () => number, colors: string[], cell: number) {
  const n = S / cell;
  // Nhiễu thô lặp liền mép: mỗi lớp màu là một trường ngẫu nhiên làm mượt vài lần.
  const field = () => {
    let f = Array.from({ length: n * n }, () => rand());
    for (let pass = 0; pass < 3; pass++) {
      const next = new Array<number>(n * n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += f[((y + dy + n) % n) * n + ((x + dx + n) % n)]!;
          next[y * n + x] = sum / 9;
        }
      }
      f = next;
    }
    return f;
  };
  g.fillStyle = colors[0]!;
  g.fillRect(0, 0, S, S);
  for (let c = 1; c < colors.length; c++) {
    const f = field();
    const sorted = [...f].sort((a, b) => a - b);
    // Mỗi lớp phủ chừng một phần tư diện tích.
    const cut = sorted[Math.floor(sorted.length * (0.72 + c * 0.04))]!;
    g.fillStyle = colors[c]!;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (f[y * n + x]! > cut || (f[y * n + x]! > cut * 0.97 && rand() < 0.35)) g.fillRect(x * cell, y * cell, cell, cell);
  }
}

/** Ghillie: nền đốm lá cỏ nhiều tầng, nhiều sợi ngắn đan chéo. */
function ghillie(g: CanvasRenderingContext2D, rand: () => number) {
  blobs(g, rand, "#3f4a2a", [
    { color: "#56603a", n: 16, r: 30 },
    { color: "#2d3520", n: 14, r: 24 },
    { color: "#6b5a38", n: 10, r: 18 },
  ]);
  const cols = ["#4f5f30", "#6d6a3c", "#2e3a1e", "#7c6a44", "#3a4a26"];
  g.lineCap = "round";
  for (let i = 0; i < 900; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = Math.PI / 2 + (rand() - 0.5) * 1.2;
    const len = 6 + rand() * 14;
    g.strokeStyle = cols[Math.floor(rand() * cols.length)]!;
    g.lineWidth = 1 + rand() * 2;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]] as const) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
}

const DRAW: Record<string, (g: CanvasRenderingContext2D, rand: () => number) => void> = {
  woodland: (g, rand) => {
    blobs(g, rand, "#8a8458", [
      { color: "#4d5a2c", n: 20, r: 30 },
      { color: "#5e4630", n: 14, r: 24 },
      { color: "#1f211a", n: 12, r: 13 },
    ]);
    grain(g, rand, 2600, 0.07);
    weave(g, rand, 0.035);
  },
  desert: (g, rand) => {
    blobs(g, rand, "#cdb88c", [
      { color: "#b39468", n: 18, r: 30 },
      { color: "#8f7253", n: 12, r: 20 },
      { color: "#e2d3ae", n: 10, r: 14 },
    ]);
    grain(g, rand, 2600, 0.06);
    weave(g, rand, 0.03);
  },
  urban: (g, rand) => {
    blobs(g, rand, "#8e9196", [
      { color: "#b9bbbd", n: 16, r: 26 },
      { color: "#5f6368", n: 16, r: 24 },
      { color: "#2f3236", n: 10, r: 14 },
    ]);
    grain(g, rand, 2600, 0.07);
    weave(g, rand, 0.035);
  },
  digital: (g, rand) => {
    pixels(g, rand, ["#7b7a52", "#565c38", "#6d5a3e", "#2c2f22"], 4);
    grain(g, rand, 1500, 0.05);
    weave(g, rand, 0.03);
  },
  snow: (g, rand) => {
    blobs(g, rand, "#e9ecef", [
      { color: "#c3c8cd", n: 16, r: 26 },
      { color: "#8f959b", n: 10, r: 16 },
      { color: "#f7f9fa", n: 8, r: 20 },
    ]);
    grain(g, rand, 2000, 0.04);
    weave(g, rand, 0.025);
  },
  ghillie,
};

const cache = new Map<string, Texture>();

/**
 * Tấm vải rằn ri lặp của một bộ trang phục (id trong OUTFITS). Dùng chung, tạo một lần.
 * Một ô vân phủ chừng 0,6 m vải (UV của hình đã được nhân sẵn theo kích thước thật).
 */
export function camoTexture(outfit: string): Texture {
  const key = outfit in DRAW ? outfit : "woodland";
  let tex = cache.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const seed = [...key].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 17) >>> 0;
  DRAW[key]!(g, mulberry32(seed));
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Kiểu vải trơn: vải lanh (sơ mi), vải bạt (quần, balo), da thuộc (giày, thắt lưng). */
export type FabricKind = "linen" | "canvas" | "leather";

const fabricCache = new Map<FabricKind, Texture>();

/**
 * Tấm vải trơn lặp gần trắng (nhân với màu vật liệu): loang màu rất nhẹ, sợi dệt, vài nếp sẫm. Dùng chung, tạo một lần.
 * Để áo quần màu người chơi có thớ vải thật thay vì phẳng lì.
 */
export function fabricTexture(kind: FabricKind): Texture {
  let tex = fabricCache.get(kind);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const rand = mulberry32(kind === "linen" ? 71 : kind === "canvas" ? 72 : 73);
  // Nền gần trắng, loang sáng tối rất nhẹ (vải bạc màu không đều).
  blobs(g, rand, "#ececec", [
    { color: "#e2e2e2", n: 18, r: 34 },
    { color: "#f6f6f6", n: 14, r: 26 },
    { color: "#dcdcdc", n: 8, r: 18 },
  ]);
  if (kind === "leather") {
    // Da thuộc: vân rạn nhỏ, lỗ chân lông.
    grain(g, rand, 5000, 0.06);
    g.strokeStyle = "rgba(0,0,0,0.05)";
    for (let i = 0; i < 160; i++) {
      const x = rand() * S;
      const y = rand() * S;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 18, y + (rand() - 0.5) * 18);
      g.stroke();
    }
  } else {
    grain(g, rand, 3000, kind === "linen" ? 0.05 : 0.07);
    weave(g, rand, kind === "linen" ? 0.045 : 0.06);
  }
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  fabricCache.set(kind, tex);
  return tex;
}
