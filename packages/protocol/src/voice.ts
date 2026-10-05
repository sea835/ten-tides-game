// Trò chuyện bằng giọng nói (WebRTC). Âm thanh đi thẳng giữa các trình duyệt; server chỉ chuyển giúp các gói
// bắt tay (offer / answer / ICE) giữa những người thật trong cùng phòng, và báo ai đang nói (để hiện biểu tượng).

import { z } from "zod";

export const VoiceMessages = {
  /** Gói bắt tay WebRTC gửi cho đúng một người (client → server → client). */
  signal: "voiceSignal",
  /** Bắt đầu / thôi nói, nói thường hay qua bộ đàm (client → server → mọi người khác). */
  talk: "voiceTalk",
} as const;

/** SDP của một kết nối chỉ có tiếng thường vài KB; chặn trên để không ai gửi rác lớn qua server. */
export const VOICE_SDP_MAX = 16_000;
export const VOICE_CANDIDATE_MAX = 1_024;
/** Nghe được tiếng nói thường trong chừng này mét, xa hơn thì im hẳn. */
export const VOICE_RANGE = 40;
/** Mỗi người nối giọng nói với nhiều nhất chừng này người (gần nhất, đồng đội trước). */
export const VOICE_MAX_PEERS = 8;

const peerId = z.string().min(1).max(64);

/** Client gửi lên: `to` là id người nhận. */
export const VoiceSignalMessage = z.discriminatedUnion("kind", [
  z.object({ to: peerId, kind: z.literal("offer"), sdp: z.string().min(1).max(VOICE_SDP_MAX) }),
  z.object({ to: peerId, kind: z.literal("answer"), sdp: z.string().min(1).max(VOICE_SDP_MAX) }),
  z.object({
    to: peerId,
    kind: z.literal("ice"),
    candidate: z.string().max(VOICE_CANDIDATE_MAX),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  }),
  /** Mới vào (hoặc vừa tải lại trang): bên kia bỏ kết nối cũ để bắt tay lại từ đầu. */
  z.object({ to: peerId, kind: z.literal("hello") }),
  /** Thôi nối (ở quá xa, đã đủ người). */
  z.object({ to: peerId, kind: z.literal("bye") }),
]);
export type VoiceSignalMessage = z.infer<typeof VoiceSignalMessage>;

/** Server chuyển xuống: giống gói gửi lên nhưng `from` thay cho `to`. */
export type VoiceSignalRelay = DistributiveOmit<VoiceSignalMessage, "to"> & { from: string };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export const VoiceTalkMessage = z.object({ on: z.boolean(), radio: z.boolean() });
export type VoiceTalkMessage = z.infer<typeof VoiceTalkMessage>;

export interface VoiceTalkBroadcast {
  from: string;
  on: boolean;
  radio: boolean;
}
