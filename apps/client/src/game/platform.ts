// Nhận diện máy chơi: hệ điều hành, trình duyệt, card đồ hoạ. Dùng để chọn mức đồ hoạ mặc định hợp máy và để báo
// khi trình duyệt đang vẽ 3D bằng CPU (tắt tăng tốc phần cứng, card bị chặn): nguyên nhân hay gặp nhất khiến game
// giật ngay từ sảnh trên Windows. Chỉ dò một lần, bằng một ngữ cảnh WebGL tạm rồi trả lại ngay cho trình duyệt.

export type Os = "win" | "mac" | "linux" | "android" | "ios" | "other";
export type Browser = "chrome" | "edge" | "firefox" | "safari" | "other";

/** Hạng card đồ hoạ đoán theo tên: "software" là vẽ bằng CPU, "weak" là card tích hợp đời cũ. */
export type GpuTier = "software" | "weak" | "ok" | "unknown";

export interface PlatformInfo {
  os: Os;
  browser: Browser;
  /** Có WebGL 2 không (three.js bản này bắt buộc WebGL 2). */
  webgl2: boolean;
  /** Tên card đồ hoạ trình duyệt cho biết (có thể rỗng hay bị làm mờ, vd. Safari chỉ báo "Apple GPU"). */
  gpu: string;
  tier: GpuTier;
}

function detectOs(): Os {
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(platform) && navigator.maxTouchPoints > 1)) return "ios";
  if (/win/i.test(platform) || /windows/i.test(ua)) return "win";
  if (/mac/i.test(platform) || /mac os/i.test(ua)) return "mac";
  if (/linux/i.test(platform) || /linux/i.test(ua)) return "linux";
  return "other";
}

function detectBrowser(): Browser {
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) return "edge";
  if (/firefox\//i.test(ua)) return "firefox";
  if (/chrome\/|crios\//i.test(ua)) return "chrome";
  if (/safari\//i.test(ua)) return "safari";
  return "other";
}

/** Vẽ bằng CPU: SwiftShader (Chrome, Edge), llvmpipe (Linux), "Microsoft Basic Render Driver" (Windows thiếu driver). */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|gdi generic/i;
/** Card tích hợp đời cũ: Intel HD / UHD (trừ Iris, Arc), card điện thoại tầm thấp. */
const WEAK = /intel.*\b(u?hd)\b(?!.*iris)|\bgma\b|mali-[gt]?[0-9]{1,2}\b|adreno.*\b[1-5][0-9]{2}\b|powervr/i;

export function classifyGpu(name: string): GpuTier {
  if (!name) return "unknown";
  if (SOFTWARE.test(name)) return "software";
  if (WEAK.test(name)) return "weak";
  return "ok";
}

function probeGpu(): Pick<PlatformInfo, "webgl2" | "gpu" | "tier"> {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false, powerPreference: "high-performance" });
    if (!gl) return { webgl2: false, gpu: "", tier: "unknown" };
    // Chrome, Edge, Firefox cho đọc thẳng tên card; bản cũ cần phần mở rộng debug.
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? "");
    return { webgl2: true, gpu, tier: classifyGpu(gpu) };
  } catch {
    return { webgl2: !!gl, gpu: "", tier: "unknown" };
  } finally {
    // Trả ngữ cảnh lại ngay: trình duyệt chỉ cho giữ chừng 16 ngữ cảnh WebGL, giữ thừa là tốn bộ nhớ card.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

let info: PlatformInfo | null = null;

/** Thông tin máy (dò lần đầu gọi, sau đó dùng lại). */
export function platform(): PlatformInfo {
  if (!info) info = { os: detectOs(), browser: detectBrowser(), ...probeGpu() };
  return info;
}
