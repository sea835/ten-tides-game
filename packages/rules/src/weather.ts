export const WEATHER_IDS = ["sunny", "cloudy", "rain", "fog", "storm", "quake"] as const;
export type WeatherId = (typeof WEATHER_IDS)[number];

export const WEATHER_LABELS: Record<WeatherId, string> = {
  sunny: "Nắng",
  cloudy: "Nhiều mây",
  rain: "Mưa",
  fog: "Sương mù",
  storm: "Bão",
  quake: "Động đất",
};

/** Tỷ trọng thời tiết trước và sau ngày núi lửa thức giấc. */
export const WEATHER_WEIGHTS: Record<"calm" | "awake", Partial<Record<WeatherId, number>>> = {
  calm: { sunny: 4, cloudy: 3, rain: 2, fog: 1, storm: 1 },
  awake: { sunny: 2, cloudy: 2, rain: 1, fog: 1, storm: 2, quake: 3 },
};
