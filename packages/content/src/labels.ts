import type { EndingId, Phase, RationId } from "@tentides/rules";

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "Sảnh chờ",
  dawn: "Bình minh",
  explore: "Khám phá",
  dusk: "Hoàng hôn",
  night: "Đêm",
  ended: "Kết thúc",
};

export const ENDING_LABELS: Record<EndingId, { title: string; text: string }> = {
  treasure_home: {
    title: "Kho báu về tay",
    text: "Cả đoàn giương buồm rời đảo cùng kho báu, ngay trước khi núi lửa phun trào.",
  },
  empty_handed: {
    title: "Tay trắng trở về",
    text: "Cả đoàn kịp rời đảo, nhưng kho báu vẫn nằm lại đâu đó dưới lớp tro núi lửa.",
  },
  buried: {
    title: "Chôn vùi cùng hòn đảo",
    text: "Không ai còn đứng dậy nổi để rời đảo. Hòn đảo nuốt trọn cả đoàn.",
  },
};

export const RATION_LABELS: Record<RationId, { title: string; detail: string }> = {
  full: { title: "Ăn no", detail: "2 khẩu phần mỗi người, vui hơn" },
  normal: { title: "Chia đều", detail: "1 khẩu phần mỗi người" },
  half: { title: "Ăn dè", detail: "2 người chung 1 khẩu phần" },
  skip: { title: "Nhịn", detail: "Giữ kho, ai cũng buồn" },
};
