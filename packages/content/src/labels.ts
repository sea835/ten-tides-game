import {
  BACKGROUND_TITLES,
  FLAW_TITLES,
  type BackgroundId,
  type Difficulty,
  type EndingId,
  type FlawId,
  type GhostActionId,
  type NightActionId,
  type Phase,
  type RationId,
  type RoleId,
} from "@tentides/rules";

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "Sảnh chờ",
  create: "Tạo nhân vật",
  pack: "Xếp balo",
  dawn: "Bình minh",
  explore: "Khám phá",
  dusk: "Hoàng hôn",
  night: "Đêm",
  ended: "Kết thúc",
};

export const ENDING_LABELS: Record<EndingId, { title: string; text: string }> = {
  treasure_home: {
    title: "Kho báu về tay",
    text: "Cả đoàn giương buồm rời đảo cùng kho báu, không ai bị bỏ lại, ngay trước khi núi lửa phun trào.",
  },
  bloody_treasure: {
    title: "Kho báu nhuốm máu",
    text: "Kho báu đã lên thuyền, nhưng cái giá phải trả là người nằm lại, người bị bỏ rơi, hoặc người bị trói oan.",
  },
  traitor_exposed: {
    title: "Lật mặt kẻ phản bội",
    text: "Cả đoàn trói đúng kẻ phản bội trước khi hắn kịp ra tay, rồi vẫn mang được kho báu rời đảo.",
  },
  sole_survivor: {
    title: "Kẻ sống sót duy nhất",
    text: "Chỉ một người kịp lên thuyền cùng rương vàng. Kho báu giờ là của riêng người đó.",
  },
  empty_handed: {
    title: "Tay trắng trở về",
    text: "Cả đoàn kịp rời đảo, nhưng kho báu vẫn nằm lại đâu đó dưới lớp tro núi lửa.",
  },
  buried: {
    title: "Chôn vùi cùng hòn đảo",
    text: "Không còn ai, hoặc không còn chiếc thuyền nào, để rời đảo. Núi lửa nuốt trọn cả đoàn.",
  },
  pirates_win: {
    title: "Cướp biển chiếm thuyền",
    text: "Tín hiệu đã tới tay băng cướp. Chúng đổ bộ đúng lúc cả đoàn định rời đi, và chiếc thuyền đổi chủ.",
  },
  sold_out: {
    title: "Bị bán đứng",
    text: "Kẻ lừa đảo dụ cả đoàn tới vịnh giao dịch của băng Hắc Triều từ đảo bên kia. Chuyến về nhà thành chuyến đi không hẹn ngày về.",
  },
};

export const ROLE_LABELS: Record<RoleId, { title: string; goal: string; power: string; side: "team" | "traitor" }> = {
  villager: {
    title: "Người thường",
    goal: "Tìm kho báu và sống sót rời đảo cùng cả đoàn.",
    power: "Không có năng lực đặc biệt. Ban đêm sửa thuyền, canh gác hoặc ngủ bù.",
    side: "team",
  },
  nurse: {
    title: "Y tá",
    goal: "Giữ cho nhiều người sống nhất tới lúc rời đảo.",
    power: "Mỗi đêm che chở một người: nếu họ lẽ ra gục tới hết đêm mai thì còn lại 1 Máu. Lộ thân phận là thành mục tiêu.",
    side: "team",
  },
  pirate: {
    title: "Cướp biển nằm vùng",
    goal: "Gửi đủ tín hiệu cho băng cướp trước khi rời đảo, hoặc làm thuyền nát hoàn toàn.",
    power: "Ban đêm có thể phá thuyền hoặc gửi tín hiệu. Bị trói thì mất năng lực.",
    side: "traitor",
  },
  con: {
    title: "Kẻ lừa đảo",
    goal: "Gom đủ số lần lừa (làm giả manh mối, bỏ túi đồ), rồi lên thuyền mà không đang bị trói.",
    power: "Ban đêm có thể làm giả manh mối hoặc lén bỏ túi đồ của người khác. Bị trói thì mất năng lực.",
    side: "traitor",
  },
};

export const NIGHT_ACTION_LABELS: Record<NightActionId, { title: string; detail: string }> = {
  repair: { title: "Sửa thuyền", detail: "Góp tay vá thuyền cho chuyến về" },
  sleep: { title: "Ngủ bù", detail: "Hồi Tinh thần" },
  guard: { title: "Canh gác", detail: "Thức canh trại, mệt hơn; có thể thấy ai lén lút" },
  search: { title: "Lục soát", detail: "Lén lục balo một người, thấy cả ngăn bí mật; mệt và áy náy, người đó sẽ biết có người lục" },
  protect: { title: "Che chở", detail: "Chọn một người, giữ họ khỏi gục tới hết đêm mai" },
  sabotage: { title: "Phá thuyền", detail: "Làm hỏng thuyền; nhẹ tay hơn nếu có người canh" },
  signal: { title: "Gửi tín hiệu", detail: "Đốt lửa báo cho băng cướp; đôi khi có người thấy ánh lửa" },
  forge: { title: "Làm giả manh mối", detail: "Tiến độ kho báu sụt, thêm một lần lừa" },
  pocket: { title: "Bỏ túi đồ", detail: "Lấy trộm một món của người khác, thêm một lần lừa" },
};

/** Việc hồn ma làm được mỗi đêm. */
export const GHOST_ACTION_LABELS: Record<GhostActionId, { title: string; detail: string }> = {
  whisper: { title: "Thì thầm", detail: "Để lại một câu ngắn trong giấc mơ của một người (không ai biết là ai nói)" },
  chill: { title: "Làm lạnh gáy", detail: "Một người thấy rợn người suốt đêm, mất chút Tinh thần" },
  guide: { title: "Dẫn lối", detail: "Khẽ đẩy cả đoàn tới gần kho báu hơn một chút" },
};

export const RATION_LABELS: Record<RationId, { title: string; detail: string }> = {
  normal: { title: "Chia đều", detail: "Mỗi người 1 phần, người đói nhất ăn trước" },
  half: { title: "Ăn dè", detail: "2 người chung 1 phần, ai cũng được chút" },
  skip: { title: "Nhịn", detail: "Giữ kho cho mai, ai cũng buồn" },
};

export const DIFFICULTY_LABELS: Record<Difficulty, { title: string; detail: string }> = {
  easy: { title: "Dễ", detail: "DC −2, 3 khẩu phần mỗi người" },
  normal: { title: "Thường", detail: "2 khẩu phần mỗi người" },
  hard: { title: "Khó", detail: "DC +2, 1 khẩu phần mỗi người" },
};

/** Xuất thân: kỹ năng hiển thị cho người chơi và móc câu cho bộ sinh truyện. */
export const BACKGROUND_LABELS: Record<BackgroundId, { title: string; skill: string; hooks: string[] }> = {
  old_sailor: {
    title: BACKGROUND_TITLES.old_sailor,
    skill: "+2 mọi phép kiểm tra ở bãi biển và hồ. Mang theo dây thừng.",
    hooks: ["từng lênh đênh ba mươi năm", "đọc được sóng và gió", "có một vết sẹo do cá mập"],
  },
  ex_medic: {
    title: BACKGROUND_TITLES.ex_medic,
    skill: "Có mặt ở đâu thì chữa trị ở đó hiệu quả gấp đôi. Mang theo bộ sơ cứu.",
    hooks: ["bỏ nghề sau một ca mổ hỏng", "bàn tay vẫn còn vững", "không chịu được cảnh người khác chảy máu"],
  },
  hunter: {
    title: BACKGROUND_TITLES.hunter,
    skill: "Kiếm được thức ăn thì được thêm một khẩu phần. Mang theo súng kíp.",
    hooks: ["đi rừng từ năm mười tuổi", "nghe tiếng động là biết con gì", "ít nói, bắn giỏi"],
  },
  archaeologist: {
    title: BACKGROUND_TITLES.archaeologist,
    skill: "+2 mọi phép kiểm tra Trí tuệ. Mang theo bản đồ cũ.",
    hooks: ["từng bị đuổi khỏi viện bảo tàng", "tin chắc truyền thuyết là thật", "mê mẩn mọi hình khắc cổ"],
  },
  rich_kid: {
    title: BACKGROUND_TITLES.rich_kid,
    skill: "Thêm 30 xu để mua đồ nhưng kém Gan dạ một bậc. Mang theo rượu rum.",
    hooks: ["trốn nhà đi tìm cảm giác mạnh", "chưa từng tự nấu một bữa ăn", "hứa trả gấp đôi cho ai cõng mình"],
  },
  gambler: {
    title: BACKGROUND_TITLES.gambler,
    skill: "Lần thua đầu tiên mỗi ngày được tự động tung lại. Mang theo bùa hộ mệnh.",
    hooks: ["đang nợ một băng đảng", "tin vào vận may hơn tin người", "cược cả chuyến đi vào kho báu"],
  },
  carpenter: {
    title: BACKGROUND_TITLES.carpenter,
    skill: "Ban đêm sửa thuyền gấp đôi người thường. Mang theo búa.",
    hooks: ["đóng thuyền cho cả làng chài", "nhìn gỗ là biết gỗ gì", "tay chai sạn, nói chuyện thẳng"],
  },
  guide: {
    title: BACKGROUND_TITLES.guide,
    skill: "+2 mọi phép kiểm tra trong hang và trên núi lửa. Mang theo đèn dầu.",
    hooks: ["từng dẫn đoàn qua núi lửa ở đảo khác", "đếm bước chân thành thói quen", "mất một người khách trong hang năm ngoái"],
  },
};

/** Tật xấu: bắt buộc chọn, đổi lấy 2 điểm thuộc tính; vừa có hiệu ứng vừa là nguyên liệu drama. */
export const FLAW_LABELS: Record<FlawId, { title: string; effect: string; hooks: string[] }> = {
  fear_heights: {
    title: FLAW_TITLES.fear_heights,
    effect: "−2 mọi phép kiểm tra trên núi lửa.",
    hooks: ["chân run khi nhìn xuống", "không dám nhìn qua mép vực"],
  },
  fear_dark: {
    title: FLAW_TITLES.fear_dark,
    effect: "−2 mọi phép kiểm tra trong hang.",
    hooks: ["ngủ phải để đèn", "nghe thấy tiếng thì thầm trong bóng tối"],
  },
  greedy: {
    title: FLAW_TITLES.greedy,
    effect: "Đêm ở trại đôi khi lén ăn thêm một khẩu phần; sáng ra cả trại chỉ thấy kho hụt.",
    hooks: ["mắt sáng lên khi thấy vàng", "giấu đồ ăn dưới gối"],
  },
  alcoholic: {
    title: FLAW_TITLES.alcoholic,
    effect: "Đêm nào không có rượu rum trong balo thì mất 10 Tinh thần.",
    hooks: ["tay run khi thiếu rượu", "say thì nói hết bí mật"],
  },
  liar: {
    title: FLAW_TITLES.liar,
    effect: "−2 mọi phép kiểm tra Duyên (khó ai tin).",
    hooks: ["kể chuyện mỗi lần một khác", "nói dối cả khi không cần"],
  },
  clumsy: {
    title: FLAW_TITLES.clumsy,
    effect: "Thua phép kiểm tra thì có thể làm rơi một món đồ.",
    hooks: ["vấp cả vào bóng mình", "đánh rơi đồ đúng lúc quan trọng nhất"],
  },
};

export const ADJACENCY_LABELS: Record<string, { title: string; effect: string }> = {
  night_reading: { title: "Đèn dầu cạnh bản đồ", effect: "Đọc bản đồ ban đêm: +2 Trí tuệ" },
  true_north: { title: "La bàn cạnh bản đồ", effect: "Định hướng chuẩn: +2 Trí tuệ" },
  powder_keg: { title: "Thuốc súng cạnh diêm", effect: "Dễ nổ: thua phép kiểm tra có thể mất 15 Máu" },
  repair_kit: { title: "Búa cạnh dây thừng", effect: "Bộ đồ sửa thuyền: sửa thêm +3 mỗi đêm" },
};
