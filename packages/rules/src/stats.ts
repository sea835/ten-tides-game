export const STAT_IDS = ["strength", "dexterity", "intellect", "charisma", "nerve"] as const;
export type StatId = (typeof STAT_IDS)[number];

export const STAT_LABELS: Record<StatId, string> = {
  strength: "Thể lực",
  dexterity: "Khéo léo",
  intellect: "Trí tuệ",
  charisma: "Duyên",
  nerve: "Gan dạ",
};

export type Stats = Record<StatId, number>;

export const ZONE_IDS = ["beach", "lake", "cave", "volcano"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];
