// Bảng phím điều khiển duy nhất của game: màn "Phím điều khiển" (sảnh, Trung tâm chỉ huy, bảng Cài đặt trong trận) và
// bài hướng dẫn đều đọc từ đây, khỏi mỗi nơi chép một danh sách rồi lệch nhau. Phím ghi theo KeyboardEvent.code (như
// mã xử lý phím trong input.ts, LocalPlayer, battle/*, naval/NavalControl); chuột là "Mouse0" (trái), "Mouse1" (giữa),
// "Mouse2" (phải), "Wheel" (lăn), "MouseMove" (rê). Tổ hợp nối bằng "+", vd. "ShiftLeft+Mouse2".
//
// Đổi phím sau này: giữ nguyên `id`, chỉ cần truyền `overrides` (id → phím mới) vào resolveKeys / controlsFor. Phím nói
// chuyện (L, U) đã đổi được trong Cài đặt → Giọng nói, màn phím truyền vào đây làm overrides.
// Mã nguồn chỗ xử lý phím không đọc bảng này (chưa có đổi phím), nên sửa phím ở đó thì sửa cả ở đây.

/** Chế độ trận (battleMode trên server). */
export type BattleModeId = "solo" | "squad" | "war" | "naval";

/** Tên chế độ như ở Trung tâm chỉ huy. */
export const MODE_NAMES: Record<BattleModeId, string> = { war: "Đại Chiến 50v50", naval: "Hải Chiến 3v3", squad: "Chỉ Huy Tiểu Đội", solo: "Sinh Tồn Sa Trường" };

export function isBattleMode(v: unknown): v is BattleModeId {
  return v === "solo" || v === "squad" || v === "war" || v === "naval";
}

export type ControlGroupId =
  | "move"
  | "combat"
  | "gear"
  | "comms"
  | "squad"
  | "war"
  | "vehicle"
  | "heli"
  | "emplacement"
  | "navalDeck"
  | "navalHelm"
  | "navalGuns"
  | "navalPilot"
  | "spectate"
  | "system";

export interface ControlGroup {
  id: ControlGroupId;
  title: string;
  /** Chế độ có nhóm phím này; không ghi là mọi chế độ. */
  modes?: readonly BattleModeId[];
}

export interface ControlDef {
  id: string;
  group: ControlGroupId;
  /** Việc phím làm. */
  action: string;
  /** Phím mặc định, mỗi phần tử là một cách bấm khác nhau (hay một dải nếu `range`). */
  keys: readonly string[];
  /** Kiểu bấm: giữ, bấm đúp. */
  how?: "hold" | "double";
  /** Hiện thành dải "1–3" (phím đầu tới phím cuối) thay vì từng phím. */
  range?: boolean;
  /** Ghi chú ngắn sau việc làm. */
  note?: string;
  /** Riêng các chế độ này (mặc định theo nhóm). */
  modes?: readonly BattleModeId[];
}

const INFANTRY: readonly BattleModeId[] = ["solo", "squad", "war"];
const LAND_VEHICLES: readonly BattleModeId[] = ["squad", "war"];

export const CONTROL_GROUPS: readonly ControlGroup[] = [
  { id: "move", title: "Di chuyển" },
  { id: "combat", title: "Chiến đấu", modes: INFANTRY },
  { id: "gear", title: "Trang bị, hồi máu", modes: INFANTRY },
  { id: "comms", title: "Liên lạc, bản đồ" },
  { id: "squad", title: "Chỉ huy tiểu đội", modes: ["squad"] },
  { id: "war", title: "Đại chiến: hồi sinh, bản đồ chỉ huy", modes: ["war"] },
  { id: "vehicle", title: "Xe tăng, xe, thuyền", modes: LAND_VEHICLES },
  { id: "heli", title: "Trực thăng", modes: LAND_VEHICLES },
  { id: "emplacement", title: "Ổ súng máy, súng cối", modes: LAND_VEHICLES },
  { id: "navalDeck", title: "Hải chiến: trên boong", modes: ["naval"] },
  { id: "navalHelm", title: "Hải chiến: lái tàu", modes: ["naval"] },
  { id: "navalGuns", title: "Hải chiến: pháo, phòng không, tên lửa, ngư lôi", modes: ["naval"] },
  { id: "navalPilot", title: "Hải chiến: phi công", modes: ["naval"] },
  { id: "spectate", title: "Khi gục, xem trận", modes: INFANTRY },
  { id: "system", title: "Hệ thống" },
];

export const CONTROLS: readonly ControlDef[] = [
  // ------------------------------------------------------------------ di chuyển (LocalPlayer.tsx)
  { id: "move", group: "move", action: "Đi lại", keys: ["KeyW", "KeyA", "KeyS", "KeyD"], note: "hoặc phím mũi tên" },
  { id: "look", group: "move", action: "Nhìn quanh, xoay người", keys: ["MouseMove"], note: "bấm vào màn hình để khoá chuột" },
  { id: "sprint", group: "move", action: "Chạy nhanh", keys: ["ShiftLeft"], how: "hold" },
  { id: "jump", group: "move", action: "Nhảy, vượt vật cản thấp", keys: ["Space"] },
  { id: "crouch", group: "move", action: "Ngồi xổm", keys: ["KeyC"], note: "đang chạy: trượt người", modes: INFANTRY },
  { id: "prone", group: "move", action: "Nằm sấp / đứng dậy", keys: ["KeyZ"] },
  { id: "lean", group: "move", action: "Nghiêng người trái / phải", keys: ["KeyQ", "KeyE"], how: "hold", modes: INFANTRY },
  { id: "dive", group: "move", action: "Khi bơi: lặn xuống", keys: ["KeyC", "ControlLeft"], how: "hold", note: "Space nổi lên" },

  // ------------------------------------------------------------------ chiến đấu (battle/Shooter.tsx, ViewModel.tsx)
  { id: "fire", group: "combat", action: "Bắn", keys: ["Mouse0"], note: "giữ: bắn liên thanh; lựu đạn: giữ rút chốt, thả ra ném" },
  { id: "aim", group: "combat", action: "Ngắm", keys: ["Mouse2"], how: "hold", note: "Cài đặt: đổi thành bấm một lần" },
  { id: "reload", group: "combat", action: "Thay đạn", keys: ["KeyR"] },
  { id: "weapons", group: "combat", action: "Súng chính 1, súng chính 2, súng lục", keys: ["Digit1", "Digit2", "Digit3"], range: true },
  { id: "cycle", group: "combat", action: "Đổi qua lại súng, lựu đạn, khí tài", keys: ["Wheel"] },
  { id: "holster", group: "combat", action: "Cất súng, cầm dao", keys: ["KeyX"] },
  { id: "melee", group: "combat", action: "Đâm dao", keys: ["KeyV"] },
  { id: "zero", group: "combat", action: "Chỉnh cự ly ống ngắm", keys: ["PageUp", "PageDown"] },
  { id: "camera", group: "combat", action: "Đổi góc nhìn thứ nhất / thứ ba", keys: ["KeyT"] },
  { id: "inspect", group: "combat", action: "Ngắm nghía súng", keys: ["KeyI"] },

  // ------------------------------------------------------------------ trang bị (Shooter.tsx, gadgets.ts, StreakHud.tsx)
  { id: "frag", group: "gear", action: "Lựu đạn", keys: ["Digit4"] },
  { id: "smoke", group: "gear", action: "Bom khói", keys: ["Digit5"] },
  { id: "flash", group: "gear", action: "Bom choáng", keys: ["Digit6"] },
  { id: "mine", group: "gear", action: "Mìn", keys: ["Digit7"] },
  { id: "bandage", group: "gear", action: "Băng bó", keys: ["Digit8"] },
  { id: "medkit", group: "gear", action: "Hộp cứu thương", keys: ["Digit9"] },
  // GADGET_KEY_LABEL trong battle/gadgets.ts.
  { id: "gadget", group: "gear", action: "Khí tài lớp lính", keys: ["Digit0"], note: "bấm lần nữa: khí tài thứ hai; chuột trái dùng", modes: LAND_VEHICLES },
  { id: "pickup", group: "gear", action: "Nhặt đồ dưới đất", keys: ["KeyF"] },
  { id: "buy", group: "gear", action: "Cửa hàng", keys: ["KeyB"] },
  // STREAK_KEY trong battle/streaks.ts.
  { id: "streak", group: "gear", action: "Bảng chi viện (đủ điểm chiến thuật)", keys: ["KeyK"], note: "1–3 chọn, Esc đóng" },

  // ------------------------------------------------------------------ liên lạc (CommsWorld.tsx, CommsHud.tsx, VoiceChat.tsx)
  { id: "ping", group: "comms", action: "Đánh dấu chỗ, địch, đồ đang nhìn", keys: ["Mouse1"], note: "bấm đúp: nguy hiểm; giữ: vòng chọn dấu", modes: INFANTRY },
  // RADIO_KEY trong battle/comms.ts.
  { id: "radio", group: "comms", action: "Vòng khẩu lệnh bộ đàm", keys: ["Backquote"], how: "hold", note: "rê chuột chọn, thả ra để gửi", modes: INFANTRY },
  // DEFAULT_VOICE trong voice/voiceSettings.ts; đổi được trong Cài đặt → Giọng nói.
  { id: "voicePtt", group: "comms", action: "Nói (người ở gần nghe)", keys: ["KeyL"], how: "hold" },
  { id: "voiceRadio", group: "comms", action: "Bộ đàm (cả đội nghe)", keys: ["KeyU"], how: "hold" },
  { id: "scoreboard", group: "comms", action: "Bảng điểm", keys: ["Tab"], how: "hold" },
  { id: "map", group: "comms", action: "Bản đồ lớn", keys: ["KeyM"], note: "Đại chiến: bản đồ chỉ huy" },

  // ------------------------------------------------------------------ tiểu đội (SquadHud.tsx)
  { id: "orderMove", group: "squad", action: "Lính tới chỗ đang nhìn và tấn công", keys: ["KeyY"], note: "nhìn vào xe tăng trống: lính lên xe" },
  { id: "orderHold", group: "squad", action: "Giữ chốt, phòng thủ quanh đây", keys: ["KeyG"] },
  { id: "orderFollow", group: "squad", action: "Tập hợp, bám theo sau", keys: ["KeyH"] },
  { id: "possess", group: "squad", action: "Khi gục: nhập vào lính ở ô đó", keys: ["Digit1", "Digit5"], range: true },
  { id: "possessWatch", group: "squad", action: "Khi gục: nhập vào người đang xem", keys: ["KeyF"] },

  // ------------------------------------------------------------------ đại chiến (WarHud.tsx, WarCommand.tsx)
  { id: "deployRole", group: "war", action: "Màn hồi sinh: chọn lớp lính", keys: ["Digit1", "Digit5"], range: true },
  { id: "deploy", group: "war", action: "Xuất kích", keys: ["Enter", "Space"] },
  { id: "cmdOpen", group: "war", action: "Mở / đóng bản đồ chỉ huy", keys: ["KeyM"] },
  { id: "cmdSelect", group: "war", action: "Bản đồ chỉ huy: kéo để chọn lính", keys: ["Mouse0"] },
  { id: "cmdAttack", group: "war", action: "Bản đồ chỉ huy: lệnh đánh chiếm chỗ bấm", keys: ["Mouse2"], note: "kéo để tô vùng" },
  { id: "cmdHold", group: "war", action: "Bản đồ chỉ huy: lệnh nấp giữ vùng", keys: ["ShiftLeft+Mouse2"] },
  { id: "cmdAll", group: "war", action: "Bản đồ chỉ huy: chọn tất cả lính", keys: ["KeyA"] },
  { id: "cmdSquad", group: "war", action: "Bản đồ chỉ huy: chọn tổ của mình", keys: ["KeyQ"] },
  { id: "cmdFree", group: "war", action: "Bản đồ chỉ huy: thả tự do tác chiến", keys: ["KeyX"] },

  // ------------------------------------------------------------------ xe (LocalPlayer.tsx, Vehicles.tsx, Carriers.tsx)
  { id: "enter", group: "vehicle", action: "Lên / xuống xe, thuyền, ổ súng", keys: ["KeyF"], note: "đứng sát bên" },
  { id: "drive", group: "vehicle", action: "Tiến, lùi (ga, phanh)", keys: ["KeyW", "KeyS"] },
  { id: "steer", group: "vehicle", action: "Bẻ lái", keys: ["KeyA", "KeyD"] },
  { id: "turret", group: "vehicle", action: "Xoay tháp pháo, đại liên", keys: ["MouseMove"] },
  { id: "vehicleFire", group: "vehicle", action: "Bắn", keys: ["Mouse0"] },
  { id: "vehicleZoom", group: "vehicle", action: "Kính ngắm pháo thủ", keys: ["Mouse2", "KeyQ"], how: "hold" },
  { id: "seat", group: "vehicle", action: "Đổi ghế (xe trinh sát, thuyền)", keys: ["Digit1", "Digit5"], range: true },

  // ------------------------------------------------------------------ trực thăng (Heli.tsx)
  { id: "heliPitch", group: "heli", action: "Chúc / ngóc mũi", keys: ["KeyW", "KeyS"] },
  { id: "heliYaw", group: "heli", action: "Quay đầu", keys: ["KeyA", "KeyD", "MouseMove"] },
  { id: "heliRoll", group: "heli", action: "Nghiêng trượt ngang", keys: ["KeyQ", "KeyE"] },
  { id: "heliLift", group: "heli", action: "Lên / xuống", keys: ["Space", "ShiftLeft"] },
  { id: "heliLook", group: "heli", action: "Nhìn tự do", keys: ["AltLeft"], how: "hold" },
  { id: "heliFire", group: "heli", action: "Rocket (phi công), súng cửa (xạ thủ)", keys: ["Mouse0"] },
  { id: "heliFlare", group: "heli", action: "Pháo sáng", keys: ["KeyX"] },
  { id: "heliCam", group: "heli", action: "Camera buồng lái / sau đuôi", keys: ["KeyC"] },
  { id: "heliSeat", group: "heli", action: "Đổi ghế", keys: ["Digit1", "Digit4"], range: true },

  // ------------------------------------------------------------------ vũ khí cố định (Emplacements.tsx)
  { id: "emplaceAim", group: "emplacement", action: "Xoay hướng bắn", keys: ["MouseMove"] },
  { id: "emplaceElev", group: "emplacement", action: "Cối: chỉnh góc ngẩng", keys: ["KeyW", "KeyS", "Wheel"] },
  { id: "emplaceFire", group: "emplacement", action: "Bắn", keys: ["Mouse0"] },
  { id: "emplaceView", group: "emplacement", action: "Nhìn chỗ đạn rơi, phóng to", keys: ["Mouse2"], how: "hold" },

  // ------------------------------------------------------------------ hải chiến (naval/NavalControl.tsx)
  { id: "station", group: "navalDeck", action: "Vào / rời vị trí (đứng ở bàn điều khiển)", keys: ["KeyF"] },
  { id: "douse", group: "navalDeck", action: "Dập lửa (đứng cạnh đám cháy)", keys: ["KeyF"], how: "hold" },
  { id: "board", group: "navalDeck", action: "Leo lưới lên tàu khi đang bơi", keys: ["KeyF"] },
  { id: "telegraph", group: "navalHelm", action: "Tay chuông máy: tăng / giảm một nấc", keys: ["KeyW", "KeyS"] },
  { id: "rudder", group: "navalHelm", action: "Bánh lái", keys: ["KeyA", "KeyD"], how: "hold" },
  { id: "stop", group: "navalHelm", action: "Dừng máy", keys: ["KeyX"] },
  { id: "torpedo", group: "navalHelm", action: "Thuyền trưởng: phóng ngư lôi theo hướng nhìn", keys: ["Mouse0"] },
  { id: "helmAlt", group: "navalHelm", action: "Bom chìm (khu trục), mồi nhử (hoa tiêu)", keys: ["Mouse2"] },
  { id: "subDive", group: "navalHelm", action: "Tàu ngầm: lặn / nổi", keys: ["KeyC"] },
  { id: "subDepth", group: "navalHelm", action: "Tàu ngầm: nông hơn / sâu hơn", keys: ["KeyQ", "KeyE"] },
  { id: "periscope", group: "navalHelm", action: "Kính tiềm vọng, ống nhòm", keys: ["Mouse2"], how: "hold" },
  { id: "gunAim", group: "navalGuns", action: "Pháo: đặt elip tản đạn lên bóng đón đầu", keys: ["MouseMove"] },
  { id: "gunFire", group: "navalGuns", action: "Pháo: bắn loạt", keys: ["Mouse0"] },
  { id: "binoc", group: "navalGuns", action: "Pháo: ống nhòm", keys: ["Mouse2"], how: "hold" },
  { id: "aaFire", group: "navalGuns", action: "Phòng không: bắn liên tục", keys: ["Mouse0"], how: "hold", note: "ngắm vào vòng đón đầu" },
  { id: "aaZoom", group: "navalGuns", action: "Phòng không: phóng to", keys: ["Mouse2"], how: "hold" },
  { id: "launch", group: "navalGuns", action: "Phóng tên lửa / ngư lôi dẫn đường", keys: ["Mouse0"] },
  { id: "steerWarhead", group: "navalGuns", action: "Lái đầu đạn vào tàu địch", keys: ["MouseMove"] },
  { id: "release", group: "navalGuns", action: "Thả đầu đạn tự dẫn, về vị trí", keys: ["Mouse0"] },
  { id: "jetLaunch", group: "navalPilot", action: "Cất cánh (ở máy phóng)", keys: ["Mouse0"] },
  { id: "jetFly", group: "navalPilot", action: "Bay theo hướng chuột", keys: ["MouseMove"] },
  { id: "jetThrottle", group: "navalPilot", action: "Ga", keys: ["KeyW", "KeyS"] },
  { id: "jetGun", group: "navalPilot", action: "Pháo 20 ly (theo dấu mũi)", keys: ["Mouse0"] },
  { id: "ordPick", group: "navalPilot", action: "Chọn bom, bom chùm, ngư lôi, rocket", keys: ["Digit1", "Digit4"], range: true },
  { id: "ordFire", group: "navalPilot", action: "Thả bom / bắn vũ khí đang chọn", keys: ["Mouse2"] },
  { id: "eject", group: "navalPilot", action: "Bỏ máy bay, về tàu", keys: ["KeyF"] },

  // ------------------------------------------------------------------ gục, xem trận (Spectator.tsx, Killcam.tsx)
  { id: "specCycle", group: "spectate", action: "Đổi người đang xem", keys: ["KeyQ", "KeyE", "Mouse0"] },
  { id: "specFree", group: "spectate", action: "Camera tự do (WASD bay, Shift nhanh)", keys: ["Space"] },
  { id: "killcamSkip", group: "spectate", action: "Bỏ qua killcam", keys: ["Space"] },

  // ------------------------------------------------------------------ hệ thống (Game.tsx, menu/SettingsPanel.tsx, sound/Soundscape.tsx)
  { id: "settings", group: "system", action: "Cài đặt (có Hướng dẫn, Phím điều khiển)", keys: ["KeyO"] },
  { id: "unlock", group: "system", action: "Thả chuột để bấm nút trên màn hình", keys: ["Escape"] },
  { id: "quality", group: "system", action: "Đổi mức đồ hoạ", keys: ["KeyP"] },
  { id: "stats", group: "system", action: "Số liệu hiệu năng", keys: ["F3"] },
  { id: "music", group: "system", action: "Tắt / bật nhạc nền", keys: ["KeyN"] },
  // tutorial/TutorialCoach.tsx (chuột đang khoá nên bài hướng dẫn dùng phím).
  { id: "tutNext", group: "system", action: "Hướng dẫn: qua bước (bước chỉ để đọc thì bấm để tiếp)", keys: ["Enter"], modes: ["solo", "squad", "war", "naval"] },
  { id: "tutOff", group: "system", action: "Hướng dẫn: tắt bài hướng dẫn", keys: ["End"], modes: ["solo", "squad", "war", "naval"] },
];

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

export function controlDef(id: string): ControlDef | undefined {
  return BY_ID.get(id);
}

/** Phím đổi riêng (id → phím), vd. phím nói chuyện trong Cài đặt → Giọng nói. */
export type KeyOverrides = Readonly<Record<string, readonly string[]>>;

/** Phím đang dùng của một việc: phím đã đổi nếu có, không thì phím mặc định. */
export function resolveKeys(id: string, overrides?: KeyOverrides): readonly string[] {
  return overrides?.[id] ?? BY_ID.get(id)?.keys ?? [];
}

const NAMED: Record<string, string> = {
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  AltLeft: "Alt",
  AltRight: "Alt",
  Space: "Space",
  Tab: "Tab",
  Escape: "Esc",
  Enter: "Enter",
  // RADIO_KEY_LABEL trong battle/comms.ts.
  Backquote: "~",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  CapsLock: "Caps Lock",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Mouse0: "Chuột trái",
  Mouse1: "Chuột giữa",
  Mouse2: "Chuột phải",
  Wheel: "Lăn chuột",
  MouseMove: "Rê chuột",
};

/** Tên phím dễ đọc từ KeyboardEvent.code (hay tên nút chuột của bảng này). Tổ hợp "A+B" thành "A + B". */
export function keyLabel(code: string): string {
  if (code.includes("+")) return code.split("+").map(keyLabel).join(" + ");
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return NAMED[code] ?? code;
}

/** Các nhãn phím để vẽ thành ô <kbd>: dải "1–3" gom thành một ô. */
export function keyChips(id: string, overrides?: KeyOverrides): string[] {
  const def = BY_ID.get(id);
  const keys = resolveKeys(id, overrides);
  if (!keys.length) return [];
  if (def?.range && !overrides?.[id] && keys.length >= 2) return [`${keyLabel(keys[0]!)}–${keyLabel(keys[keys.length - 1]!)}`];
  return keys.map(keyLabel);
}

/** Phím của một việc thành chữ, vd. "W/A/S/D", "1–3", "giữ Shift". */
export function keyText(id: string, overrides?: KeyOverrides): string {
  const chips = keyChips(id, overrides).join("/");
  return BY_ID.get(id)?.how === "hold" ? `giữ ${chips}` : chips;
}

/** Nhóm phím có trong chế độ này (null: mọi nhóm, dùng ở sảnh khi chưa chọn chế độ). */
export function groupsFor(mode: BattleModeId | null): ControlGroup[] {
  return CONTROL_GROUPS.filter((g) => !mode || !g.modes || g.modes.includes(mode));
}

/** Các phím của một nhóm trong chế độ này (đã bỏ phím riêng của chế độ khác). */
export function controlsFor(group: ControlGroupId, mode: BattleModeId | null): ControlDef[] {
  return CONTROLS.filter((c) => c.group === group && (!mode || !c.modes || c.modes.includes(mode)));
}

/** Đoạn chữ có chỗ chèn phím: "{move}" là phím của việc "move" trong bảng. Tách ra để vẽ ô <kbd>. */
export type RichPart = { text: string } | { control: string };

export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  const re = /\{([A-Za-z0-9]+)\}/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push(BY_ID.has(m[1]!) ? { control: m[1]! } : { text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Đổi cả đoạn chữ có chỗ chèn phím sang chữ thường (vd. cho title, aria-label). */
export function richText(text: string, overrides?: KeyOverrides): string {
  return richParts(text)
    .map((p) => ("text" in p ? p.text : keyText(p.control, overrides)))
    .join("");
}
