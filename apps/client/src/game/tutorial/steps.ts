import type { NavalRole } from "@tentides/content";
import { isBattleMode, type BattleModeId } from "../controlsMap.ts";

// Bài hướng dẫn tương tác: mỗi chế độ một kịch bản gồm các bước, bước nào xong khi người chơi LÀM ĐÚNG việc đó (đo từ
// phím bấm, chuyển động, trạng thái phòng; xem signals.ts), không chỉ đọc chữ. Toàn bộ logic chọn bước và chuyển bước
// ở file này là hàm thuần (không đụng DOM, phòng, localStorage) để kiểm thử được.
//
// Tín hiệu (Signals) là bộ đếm tích luỹ từ lúc vào trận: bước ghi lại ảnh chụp tín hiệu lúc bắt đầu, xong khi mức
// tăng (delta) đủ ngưỡng `need`, và các tín hiệu trạng thái (0/1) đạt ngưỡng `state`. Tên tín hiệu quy ước:
//   walk (m), sprint (giây), ads (giây ngắm), shots, reload, switch, key:<code> (số lần bấm), mouse:<0|1|2> (bấm khi
//   chuột khoá), ui:<0|1|2> (bấm khi chuột đang thả: bản đồ chỉ huy), vehicle (lần lên xe), flagTime (giây trong vòng
//   cứ điểm), flagsTaken (cứ điểm phe mình vừa chiếm), stationed (0/1), stClick0|2 (bấm chuột khi đứng vị trí trên tàu),
//   aimMove (radian xoay camera khi đứng vị trí), throttleChanges, rudder (giây), flying (giây lái máy bay), flyEnd,
//   steer (giây lái đầu đạn), release (lần thả đầu đạn), douse (giây dập lửa).

export type Signals = Readonly<Record<string, number>>;

/** Hoàn cảnh người chơi lúc xét bước: chế độ, vị trí trên tàu (hải chiến), lớp tàu, có khí tài / xe không. */
export interface TutorialCtx {
  mode: BattleModeId;
  /** Vai trò ở vị trí đang đứng trên tàu; rỗng là chưa đứng vị trí nào (hay không phải hải chiến). */
  role: NavalRole | "";
  /** Lớp tàu của phe mình (hải chiến). */
  cls: string;
  /** Lớp lính có khí tài (phím 0). */
  gadget: boolean;
  /** Trận có xe, trực thăng, ổ súng để lên. */
  vehicles: boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  /** Lời hướng dẫn; `{id}` chèn phím của việc `id` trong controlsMap.ts (richParts). */
  hint: string;
  /** Mức tăng tối thiểu của từng tín hiệu so với lúc bắt đầu bước. Rỗng và không `state`: bước đọc, bấm Enter để tiếp. */
  need?: Readonly<Record<string, number>>;
  /** Tín hiệu trạng thái phải đạt ít nhất giá trị này (tuyệt đối, không tính mức tăng). */
  state?: Readonly<Record<string, number>>;
  /** true: chỉ cần một điều kiện đạt (mặc định: phải đạt tất cả). */
  any?: boolean;
  /** Chỉ dành cho các vai trò này trên tàu; vai khác thì bỏ bước. Chưa đứng vị trí nào (rỗng) thì bước vẫn chờ. */
  roles?: readonly NavalRole[];
  /** Chỉ dành cho các lớp tàu này. */
  classes?: readonly string[];
  /** Chỉ hiện khi hoàn cảnh có cờ này. */
  requires?: "gadget" | "vehicles";
}

export interface TutorialRun {
  /** Chỉ số bước đang làm; bằng độ dài kịch bản là đã xong. */
  index: number;
  /** Ảnh chụp tín hiệu lúc bắt đầu bước. */
  start: Signals;
}

// ---------------------------------------------------------------------------- kịch bản

const WALK: TutorialStep = {
  id: "walk",
  title: "Di chuyển",
  hint: "Bấm vào màn hình để khoá chuột, rồi dùng {move} để đi, rê chuột để nhìn quanh.",
  need: { walk: 8 },
};
const SPRINT: TutorialStep = { id: "sprint", title: "Chạy nhanh", hint: "Giữ {sprint} khi đang đi để chạy. Chạy tốn sức nên chỉ chạy khi cần vượt chỗ trống.", need: { sprint: 1.5 } };
const BUY: TutorialStep = { id: "buy", title: "Mua vũ khí", hint: "Bấm {buy} mở cửa hàng, chọn súng và đạn bằng tiền khởi điểm, bấm {buy} lần nữa để đóng.", need: { "key:KeyB": 1 } };
const AIM: TutorialStep = { id: "aim", title: "Ngắm", hint: "Giữ {aim} để ngắm. Ngắm thì đạn chụm hơn nhưng đi chậm hơn.", need: { ads: 1 } };
const SHOOT: TutorialStep = { id: "shoot", title: "Bắn", hint: "Bấm {fire} để bắn. Giữ chuột để bắn liên thanh; súng giật nên bắn từng loạt ngắn sẽ trúng hơn.", need: { shots: 3 } };
const RELOAD: TutorialStep = { id: "reload", title: "Thay đạn", hint: "Bấm {reload} để thay băng đạn. Thay lúc đang an toàn, đừng đợi hết đạn giữa giao tranh.", need: { reload: 1 } };
const SWITCH: TutorialStep = { id: "switch", title: "Đổi vũ khí", hint: "Đổi vũ khí bằng {weapons} (súng chính, súng lục), hay lăn chuột. {holster} để cất súng.", need: { switch: 1 } };
const GADGET: TutorialStep = {
  id: "gadget",
  title: "Khí tài lớp lính",
  hint: "Bấm {gadget} rút khí tài của lớp lính (ô khí tài ở góc phải dưới), rồi dùng bằng {fire}. Bấm {gadget} lần nữa để đổi khí tài thứ hai.",
  need: { "key:Digit0": 1 },
  requires: "gadget",
};
const MARK: TutorialStep = { id: "mark", title: "Đánh dấu địch", hint: "Nhìn vào địch hay một món đồ rồi bấm {ping} (chuột giữa) để đánh dấu cho đồng đội. Bấm đúp là báo nguy hiểm.", need: { "mouse:1": 1 } };
const RADIO: TutorialStep = { id: "radio", title: "Vòng khẩu lệnh", hint: "Giữ {radio}, rê chuột chọn một khẩu lệnh (cần chi viện, đang tiến...), thả phím để gửi cho đồng đội.", need: { "key:Backquote": 1 } };
const SQUAD_ORDERS: TutorialStep = {
  id: "squadOrders",
  title: "Ra lệnh cho lính AI",
  hint: "Bạn dẫn 5 lính AI. {orderMove}: tới chỗ đang nhìn và tấn công; {orderHold}: giữ chốt; {orderFollow}: tập hợp bám theo. Thử một lệnh.",
  need: { "key:KeyY": 1, "key:KeyG": 1, "key:KeyH": 1 },
  any: true,
};
const WAR_MAP: TutorialStep = { id: "warMap", title: "Bản đồ chỉ huy", hint: "Bấm {cmdOpen} để mở bản đồ chỉ huy: thấy cứ điểm A–G và lính của bạn.", need: { "key:KeyM": 1 } };
const WAR_ORDER: TutorialStep = {
  id: "warOrder",
  title: "Giao lệnh cho cả tổ",
  hint: "Trên bản đồ: kéo {cmdSelect} để chọn lính (hay {cmdAll} chọn hết), rồi bấm {cmdAttack} vào chỗ cần đánh chiếm. Xong bấm {cmdOpen} đóng bản đồ.",
  need: { "ui:2": 1 },
};
const ENTER_VEHICLE: TutorialStep = { id: "vehicle", title: "Lên xe", hint: "Đứng sát xe tăng, xuồng, trực thăng hay ổ súng máy rồi bấm {enter} để lên; bấm lần nữa để xuống. Trên xe, 1–4 đổi ghế.", need: { vehicle: 1 }, requires: "vehicles" };
const WAR_FLAG: TutorialStep = { id: "flagReach", title: "Tới cứ điểm", hint: "Chạy tới một cứ điểm (vòng tròn có cờ, chữ A–G trên bản đồ) và đứng trong vòng.", need: { flagTime: 2 } };
const WAR_CAPTURE: TutorialStep = { id: "flagCapture", title: "Chiếm cứ điểm", hint: "Đứng trong vòng, đồng đội cùng đứng thì chiếm nhanh hơn. Phe giữ ít cứ điểm hơn bị trừ vé dần.", need: { flagsTaken: 1 } };
const BR_END: TutorialStep = { id: "done", title: "Sẵn sàng", hint: "Xong phần cơ bản. Bấm {settings} mở Cài đặt rồi vào Phím điều khiển để xem mọi phím; trong đó có nút Hướng dẫn để học lại.", need: {} };

/** Chèn bước nếu có (bỏ phần tử rỗng). */
const steps = (...list: (TutorialStep | null)[]) => list.filter((s): s is TutorialStep => !!s);

const SCRIPTS: Record<Exclude<BattleModeId, "naval">, readonly TutorialStep[]> = {
  solo: steps(WALK, SPRINT, BUY, AIM, SHOOT, RELOAD, SWITCH, MARK, RADIO, BR_END),
  squad: steps(WALK, SPRINT, BUY, AIM, SHOOT, RELOAD, SWITCH, GADGET, MARK, RADIO, SQUAD_ORDERS, ENTER_VEHICLE, BR_END),
  war: steps(WALK, SPRINT, AIM, SHOOT, RELOAD, SWITCH, GADGET, MARK, RADIO, WAR_MAP, WAR_ORDER, ENTER_VEHICLE, WAR_FLAG, WAR_CAPTURE, BR_END),
};

const NAVAL: readonly TutorialStep[] = steps(
  { id: "deckWalk", title: "Đi trên boong", hint: "Bạn đứng trên chiến hạm. Dùng {move} đi lại trên boong; tàu chạy thì boong chạy theo.", need: { walk: 5 } },
  { id: "man", title: "Vào vị trí", hint: "Đi tới bàn điều khiển (vòng sáng trên boong) rồi bấm {station}. Mỗi tàu có ba vị trí, thiếu người thì máy lấp chỗ.", state: { stationed: 1 } },
  // Thuyền trưởng, hoa tiêu: lái tàu.
  { id: "throttle", title: "Tay chuông máy", hint: "{telegraph}: W tăng, S giảm một nấc tay chuông máy; {stop} dừng máy hẳn. Tàu nặng nên tăng tốc từ từ.", need: { throttleChanges: 2 }, roles: ["captain", "navigator"] },
  { id: "rudder", title: "Bẻ lái", hint: "Giữ {rudder} để bẻ lái. Quay đầu cần thời gian, đón đầu tàu địch từ xa chứ đừng đợi áp sát.", need: { rudder: 1.5 }, roles: ["captain", "navigator"] },
  { id: "submarine", title: "Tàu ngầm", hint: "{subDive} lặn / nổi; {subDepth} đổi độ sâu (Q nông hơn, E sâu hơn). Lặn thì khó bị thấy nhưng hết dưỡng khí phải nổi lên; giữ {periscope} (nổi nông) để nhìn bằng kính tiềm vọng.", need: {}, roles: ["captain"], classes: ["submarine"] },
  { id: "torpedo", title: "Phóng ngư lôi", hint: "Nhìn về phía tàu địch rồi bấm {torpedo}. Dấu đón đầu cho biết điểm ngư lôi gặp tàu địch.", need: { stClick0: 1 }, roles: ["captain"] },
  { id: "decoy", title: "Mồi nhử", hint: "Bấm {helmAlt} để phóng mồi nhử: lừa tên lửa và ngư lôi của địch đánh trượt.", need: { stClick2: 1 }, roles: ["navigator"] },
  // Pháo thủ.
  { id: "gunAim", title: "Ngắm pháo", hint: "Rê chuột: điểm ngắm là chỗ tia nhìn chạm mặt biển, máy tự tính góc nâng. Đặt elip tản đạn lên bóng đón đầu của tàu địch.", need: { aimMove: 0.8 }, roles: ["gunner"] },
  { id: "gunFire", title: "Bắn pháo", hint: "Bấm {gunFire} bắn loạt. Giữ {binoc} để dùng ống nhòm xem kỹ hơn. Ụ pháo hỏng hay đang nạp thì không bắn được.", need: { stClick0: 1 }, roles: ["gunner"] },
  // Phòng không.
  { id: "aaAim", title: "Ngắm phòng không", hint: "Rê chuột ngắm lên trời: đặt tâm vào vòng đón đầu của máy bay, tên lửa địch (chúng bay nhanh nên bắn vào chỗ chúng sắp tới).", need: { aimMove: 0.8 }, roles: ["aa"] },
  { id: "aaFire", title: "Bắn phòng không", hint: "Giữ {aaFire} để bắn liên tục; giữ {aaZoom} để phóng to. Phòng không cũng bắn được lính trên boong tàu địch.", need: { stClick0: 1 }, roles: ["aa"] },
  // Tên lửa, ngư lôi dẫn đường.
  { id: "launch", title: "Phóng", hint: "Bấm {launch} để phóng. Camera chuyển sang nhìn từ đầu đạn.", need: { stClick0: 1 }, roles: ["missile", "torpedo"] },
  { id: "steerWarhead", title: "Lái đầu đạn", hint: "Rê chuột để lái đầu đạn vào tàu địch. Tên lửa phải tránh lưới phòng không; ngư lôi dẫn đường chạy dưới mặt nước.", need: { steer: 3 }, roles: ["missile", "torpedo"] },
  { id: "release", title: "Thả cho tự dẫn", hint: "Bấm chuột để thả đầu đạn: nó tự dẫn tiếp tới tàu địch, còn bạn về lại vị trí.", need: { release: 1 }, roles: ["missile", "torpedo"] },
  // Phi công (tàu sân bay).
  { id: "jetLaunch", title: "Cất cánh", hint: "Bấm {jetLaunch} ở máy phóng để cất cánh.", need: { flying: 0.5 }, roles: ["pilot"] },
  { id: "jetFly", title: "Bay", hint: "Máy bay bay theo hướng chuột; {jetThrottle} chỉnh ga. Bay thấp quanh tàu địch để bắn, thả bom.", need: { flying: 4 }, roles: ["pilot"] },
  { id: "jetBomb", title: "Vũ khí máy bay", hint: "{jetGun} bắn pháo 20 ly; {ordPick} chọn bom, bom chùm, ngư lôi, rocket rồi bấm {ordFire} để thả. Vòng trên mặt biển là chỗ bom rơi.", need: { stClick2: 1 }, roles: ["pilot"] },
  { id: "jetEject", title: "Về tàu", hint: "Bấm {eject} để bỏ máy bay, trở về vị trí phi công trên tàu. Máy bay bị bắn rơi thì chờ máy bay mới.", need: { flyEnd: 1 }, roles: ["pilot"] },
  // Mọi vai.
  { id: "leave", title: "Rời vị trí", hint: "Bấm {station} lần nữa để rời vị trí và quay lại boong. Chết thì hồi sinh trên tàu.", state: { stationed: 0 } },
  { id: "damage", title: "Dập lửa, hư hại", hint: "Bộ phận trúng đạn thì hỏng, bốc cháy (xem bảng tàu bên trái). Đứng cạnh đám cháy và giữ {douse} để dập; bộ phận hỏng hẳn thì ụ súng đó không dùng được nữa. Đang bơi: {board} để leo lưới lên tàu.", need: {} },
  { id: "done", title: "Sẵn sàng", hint: "Đánh chìm tàu địch là thắng. Bấm {settings} mở Cài đặt rồi vào Phím điều khiển để xem mọi phím; trong đó có nút Hướng dẫn để học lại.", need: {} },
);

/** Kịch bản của chế độ. */
export function scriptFor(mode: BattleModeId): readonly TutorialStep[] {
  return mode === "naval" ? NAVAL : SCRIPTS[mode];
}

// ---------------------------------------------------------------------------- tiến trình (hàm thuần)

/** Bước có áp dụng cho hoàn cảnh này không (đúng vai, đúng lớp tàu, có khí tài / xe). */
export function applies(step: TutorialStep, ctx: TutorialCtx): boolean {
  if (step.requires === "gadget" && !ctx.gadget) return false;
  if (step.requires === "vehicles" && !ctx.vehicles) return false;
  if (step.classes && !step.classes.includes(ctx.cls)) return false;
  // Chưa đứng vị trí nào thì giữ bước (chờ người chơi vào lại vị trí), đứng vị trí khác vai thì bỏ.
  if (step.roles && ctx.role && !step.roles.includes(ctx.role)) return false;
  return true;
}

/** Bước chỉ để đọc (không có điều kiện làm): bấm Enter để qua. */
export function isManual(step: TutorialStep): boolean {
  return !step.state && Object.keys(step.need ?? {}).length === 0;
}

/** Các điều kiện của bước dưới dạng tỉ lệ hoàn thành 0..1 (mỗi điều kiện một phần tử). */
function ratios(step: TutorialStep, sig: Signals, start: Signals): number[] {
  const out: number[] = [];
  for (const [k, n] of Object.entries(step.need ?? {})) out.push(n <= 0 ? 1 : Math.max(0, Math.min(1, ((sig[k] ?? 0) - (start[k] ?? 0)) / n)));
  for (const [k, n] of Object.entries(step.state ?? {})) {
    // Tín hiệu trạng thái 0/1: ngưỡng 0 nghĩa là "không còn ở trạng thái đó" (≤ 0), ngưỡng dương là "đang ở".
    const v = sig[k] ?? 0;
    out.push(n <= 0 ? (v <= 0 ? 1 : 0) : Math.max(0, Math.min(1, v / n)));
  }
  return out;
}

/** Bước đã làm xong chưa. Bước chỉ để đọc thì không bao giờ tự xong. */
export function isDone(step: TutorialStep, sig: Signals, start: Signals): boolean {
  if (isManual(step)) return false;
  const r = ratios(step, sig, start);
  return step.any ? r.some((x) => x >= 1) : r.every((x) => x >= 1);
}

/** Tiến độ 0..1 của bước, cho thanh tiến độ. */
export function progressOf(step: TutorialStep, sig: Signals, start: Signals): number {
  const r = ratios(step, sig, start);
  if (!r.length) return 0;
  return step.any ? Math.max(...r) : r.reduce((a, b) => a + b, 0) / r.length;
}

export function startRun(sig: Signals): TutorialRun {
  return { index: 0, start: sig };
}

export function isFinished(script: readonly TutorialStep[], run: TutorialRun): boolean {
  return run.index >= script.length;
}

/** Chuyển sang bước kế tiếp áp dụng được; mốc đo của bước mới là tín hiệu lúc này. */
function moveNext(script: readonly TutorialStep[], from: number, sig: Signals, ctx: TutorialCtx): TutorialRun {
  let i = from;
  while (i < script.length && !applies(script[i]!, ctx)) i++;
  return { index: i, start: sig };
}

/**
 * Cập nhật tiến trình theo tín hiệu mới: bỏ các bước không áp dụng, qua bước nếu vừa làm xong. Mỗi lần gọi chỉ qua
 * một bước làm được (bước mới đo lại từ đầu), nên không có chuyện bước sau tự xong nhờ việc của bước trước.
 */
export function advance(script: readonly TutorialStep[], run: TutorialRun, sig: Signals, ctx: TutorialCtx): TutorialRun {
  if (isFinished(script, run)) return run;
  const skipped = moveNext(script, run.index, run.start, ctx);
  const cur = script[skipped.index];
  if (!cur) return skipped;
  if (skipped.index !== run.index) return { index: skipped.index, start: sig };
  if (isDone(cur, sig, run.start)) return moveNext(script, run.index + 1, sig, ctx);
  return run;
}

/** Người chơi bấm bỏ qua bước hiện tại. */
export function skipStep(script: readonly TutorialStep[], run: TutorialRun, sig: Signals, ctx: TutorialCtx): TutorialRun {
  if (isFinished(script, run)) return run;
  return moveNext(script, run.index + 1, sig, ctx);
}

/** Số bước còn áp dụng được cho hoàn cảnh (để hiện "bước 3/12"). */
export function visibleCount(script: readonly TutorialStep[], ctx: TutorialCtx): number {
  return script.filter((s) => applies(s, ctx)).length;
}

/** Thứ tự (từ 1) của bước đang làm trong các bước áp dụng được. */
export function stepNumber(script: readonly TutorialStep[], run: TutorialRun, ctx: TutorialCtx): number {
  let n = 0;
  for (let i = 0; i <= Math.min(run.index, script.length - 1); i++) if (applies(script[i]!, ctx)) n++;
  return n;
}

// ---------------------------------------------------------------------------- nhớ đã xem

const SEEN_KEY = "tentides.tutorial";

/** Chỗ lưu tối thiểu (localStorage), để thay được khi kiểm thử hay khi trình duyệt chặn. */
export interface SeenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): SeenStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Các chế độ đã xem hướng dẫn. Không đọc được thì coi như chưa xem chế độ nào. */
export function loadSeen(store: SeenStore | null = defaultStore()): BattleModeId[] {
  try {
    const raw = store?.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isBattleMode) : [];
  } catch {
    return [];
  }
}

export function hasSeen(mode: BattleModeId, store?: SeenStore | null): boolean {
  return loadSeen(store).includes(mode);
}

/** Ghi nhớ đã xem hướng dẫn chế độ này. Không ghi được thì thôi (lần sau hiện lại). */
export function markSeen(mode: BattleModeId, store: SeenStore | null = defaultStore()) {
  try {
    const seen = new Set(loadSeen(store));
    seen.add(mode);
    store?.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Không lưu được thì chỉ nhắc lại lần sau.
  }
}
