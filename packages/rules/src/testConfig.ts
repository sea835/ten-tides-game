import type { GameConfig } from "./game.ts";

/** Bộ nội dung tối thiểu cho test của rules, độc lập với @tentides/content. */
export const testConfig: GameConfig = {
  items: [
    { id: "rope", name: "Dây thừng" },
    { id: "shovel", name: "Xẻng" },
    { id: "lantern", name: "Đèn dầu" },
    { id: "rum", name: "Rượu rum" },
  ],
  anchors: [
    { id: "grove_1", type: "grove", zone: "beach" },
    { id: "grove_2", type: "grove", zone: "beach" },
    { id: "cave_1", type: "tunnel", zone: "cave" },
  ],
  cards: [
    {
      id: "coconut",
      title: "Cây dừa",
      intro: "Một cây dừa trĩu quả.",
      acts: [1, 2, 3],
      anchorType: "grove",
      choices: [
        {
          id: "climb",
          label: "Trèo lên",
          check: { stat: "dexterity", dc: 10, itemBonus: { rope: 2 } },
          onSuccess: { food: 2 },
          onFail: { hp: -10 },
          successText: "Hái được dừa.",
          failText: "Trượt chân ngã.",
        },
        {
          id: "shake",
          label: "Rung cây",
          check: { stat: "strength", dc: 12 },
          onSuccess: { food: 1 },
          onFail: { morale: -5 },
          successText: "Rơi một quả.",
          failText: "Không ăn thua.",
        },
      ],
      narrativeHooks: [],
    },
    {
      id: "deadly",
      title: "Vực sâu",
      intro: "Một vực thẳm.",
      acts: [1, 2, 3],
      anchorType: "tunnel",
      choices: [
        {
          id: "jump",
          label: "Nhảy",
          check: { stat: "nerve", dc: 99 },
          onSuccess: {},
          onFail: { hp: -999, loseRandomItem: 1 },
          successText: "",
          failText: "Rơi xuống.",
        },
        {
          id: "map",
          label: "Tìm đường",
          check: { stat: "intellect", dc: 1 },
          onSuccess: { treasure: 60, setFlag: "found_path" },
          onFail: {},
          successText: "Thấy lối đi.",
          failText: "",
        },
      ],
      sceneState: { onAny: "tunnel_explored" },
      narrativeHooks: [],
    },
  ],
};
