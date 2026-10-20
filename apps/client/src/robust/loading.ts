import { richText, type BattleModeId } from "../game/controlsMap.ts";

// Dữ liệu cho màn tải: mẹo chơi (đúng với game hiện tại, phím lấy từ controlsMap.ts) và ước lượng tiến độ.

interface Tip {
  /** Chỉ hiện ở các chế độ này (mặc định mọi chế độ). */
  modes?: readonly BattleModeId[];
  /** Lời mẹo; `{id}` là phím của việc `id` trong controlsMap.ts. */
  text: string;
}

const TIPS: readonly Tip[] = [
  { text: "Bấm vào màn hình để khoá chuột. Bấm {settings} bất cứ lúc nào để mở Cài đặt, trong đó có Phím điều khiển và Hướng dẫn." },
  { text: "Ngắm ({aim}) thì đạn chụm hơn, nhưng đi chậm hơn. Bắn từng loạt ngắn sẽ trúng hơn bóp cò liên tục." },
  { text: "Súng giật lên: kéo chuột xuống nhẹ trong lúc bắn để ghì tâm ngắm lại." },
  { text: "Thay đạn ({reload}) lúc đang an toàn, đừng đợi hết đạn giữa giao tranh." },
  { text: "Ngồi xổm ({crouch}), nằm sấp ({prone}) hay nghiêng người ({lean}) sau vật cản để lộ ít người hơn khi bắn." },
  { text: "Bấm {ping} (chuột giữa) vào địch hay món đồ để đánh dấu cho đồng đội; bấm đúp là báo nguy hiểm." },
  { text: "Giữ {radio} để mở vòng khẩu lệnh bộ đàm: rê chuột chọn rồi thả ra để gửi cho đồng đội." },
  { text: "Giữ {voicePtt} để nói với người ở gần, giữ {voiceRadio} để nói qua bộ đàm cho cả đội." },
  { text: "Đứng sát xe, thuyền hay ổ súng rồi bấm {enter} để lên; bấm lần nữa để xuống." },
  { text: "Lựu đạn: giữ chuột trái để rút chốt rồi thả ra để ném." },
  { text: "Ống ngắm 4x trở lên có vạch bù đạn rơi; {zero} chỉnh cự ly ngắm theo mục tiêu." },
  { text: "Nếu hình giật, bấm {quality} để đổi mức đồ hoạ hoặc {stats} xem số khung hình." },
  { text: "Người mù màu: Cài đặt có chế độ màu phe xanh dương / cam, đổi cỡ giao diện và giảm rung camera." },
  { modes: ["solo"], text: "Sinh Tồn Sa Trường: trong pha chuẩn bị bấm {buy} để mua súng và đạn; vùng an toàn thu hẹp dần, ở ngoài vòng sẽ mất máu." },
  { modes: ["solo"], text: "Thùng thính rơi bằng dù có đồ tốt (khói đỏ báo vị trí), nhưng cũng kéo cả những người khác tới." },
  { modes: ["squad"], text: "Chỉ Huy Tiểu Đội: {orderMove} gửi lính tới chỗ đang nhìn, {orderHold} giữ chốt, {orderFollow} gọi về bám theo." },
  { modes: ["squad"], text: "Nhìn vào xe tăng trống của đội rồi bấm {orderMove}: lính lái tăng chạy tới lên xe." },
  { modes: ["squad"], text: "Gục rồi vẫn chưa hết: bấm 1–5 để nhập vào lính AI còn sống và chơi tiếp." },
  { modes: ["war"], text: "Đại Chiến 50v50: đứng trong vòng cứ điểm để chiếm. Phe giữ ít cứ điểm hơn bị trừ vé dần, mỗi lần gục mất một vé." },
  { modes: ["war"], text: "Bấm {cmdOpen} mở bản đồ chỉ huy: kéo chuột trái chọn lính, chuột phải giao lệnh đánh chiếm, Shift + chuột phải bảo nấp giữ vùng." },
  { modes: ["war"], text: "Gục thì chọn lớp lính và chỗ hồi sinh (căn cứ, cạnh đội trưởng, cứ điểm phe mình), rồi bấm Enter để xuất kích." },
  { modes: ["naval"], text: "Hải Chiến: đi tới bàn điều khiển (vòng sáng trên boong) rồi bấm {station} để vào vị trí. Mỗi tàu có ba vị trí." },
  { modes: ["naval"], text: "Bộ phận tàu trúng đạn sẽ hỏng, bốc cháy. Rời vị trí, đứng cạnh đám cháy và giữ {douse} để dập; ụ súng hỏng thì không bắn được." },
  { modes: ["naval"], text: "Pháo thủ: đặt elip tản đạn lên bóng đón đầu của tàu địch rồi bắn loạt. Đạn bay vài giây nên phải bắn vào chỗ tàu địch sắp tới." },
  { modes: ["naval"], text: "Thuyền trưởng: tay chuông máy tăng giảm từng nấc ({telegraph}); tàu nặng nên quay chậm, hãy bẻ lái sớm." },
  { modes: ["naval"], text: "Phòng không bắn cả lính trên boong tàu địch, không chỉ máy bay và tên lửa." },
];

/** Các mẹo hợp chế độ (chưa biết chế độ thì mọi mẹo chung và của mọi chế độ). */
export function tipsFor(mode: BattleModeId | null): string[] {
  return TIPS.filter((t) => !t.modes || !mode || t.modes.includes(mode)).map((t) => richText(t.text));
}

/** Mẹo thứ n (xoay vòng), `offset` để mỗi lần tải bắt đầu ở một mẹo khác. */
export function tipAt(mode: BattleModeId | null, n: number, offset = 0): string {
  const list = tipsFor(mode);
  return list[(((n + offset) % list.length) + list.length) % list.length]!;
}

/**
 * Ước lượng tiến độ tải 0..1. Nhập khẩu động không báo phần trăm, nên chạy mô phỏng tiệm cận 85% trong lúc chờ và
 * nhảy lên 100% khi mã đã về.
 */
export function loadProgress(elapsedMs: number, chunkReady: boolean): number {
  if (chunkReady) return 1;
  return Math.min(0.85, 0.85 * (1 - Math.exp(-Math.max(0, elapsedMs) / 3500)));
}

export function loadStage(chunkReady: boolean): string {
  return chunkReady ? "Dựng chiến trường…" : "Tải mã trò chơi…";
}
