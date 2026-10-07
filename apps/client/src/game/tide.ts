// Mực nước biển hiện tại phía client (thủy triều của đảo sinh tồn, xem tide.ts của content). Battleground không có
// thủy triều nên luôn là WATER_LEVEL; SurvivalWorld cập nhật mỗi khung hình khi đang ở đảo sinh tồn.

import { WATER_LEVEL } from "@tentides/content";

export const tide = { level: WATER_LEVEL as number };
