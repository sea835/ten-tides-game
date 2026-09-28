// Chạm trán ngoài thẻ sự kiện: easter egg, điểm bất thường, bẫy, sinh vật, đuối nước, lửa, dung nham.
// Server làm trọng tài thời gian thực (ai đứng đâu, con vật nào cắn ai, bẫy ở đâu) rồi đưa hệ quả đã tính
// vào hành động; engine chỉ kiểm tra hợp lệ, áp hệ quả và ghi nhật ký cho bộ sinh truyện.

import { gainItem } from "./inventory.ts";
import { checkDeaths } from "./endings.ts";
import { ENCOUNTER_EFFECT_LIMIT, clamp, fail, type EncounterEffects, type GameAction, type GameConfig, type GameState, type Phase } from "./types.ts";

/** Những pha người chơi đi lại trên đảo, nên mới có chạm trán. */
export const ENCOUNTER_PHASES: readonly Phase[] = ["dawn", "explore", "dusk"];

const limit = (v: number | undefined) => clamp(Math.round(v ?? 0), -ENCOUNTER_EFFECT_LIMIT, ENCOUNTER_EFFECT_LIMIT);

export function encounter(state: GameState, action: Extract<GameAction, { type: "encounter" }>, config: GameConfig): GameState {
  if (!ENCOUNTER_PHASES.includes(state.phase)) fail("Lúc này không có chạm trán nào");
  const p = state.players[action.playerId] ?? fail("Không có người chơi này");
  if (!p.alive) fail("Người đã gục không chạm trán được");
  if (action.once && state.discovered.includes(action.refId)) fail("Đã có người tìm thấy chỗ này rồi");

  const effects: EncounterEffects = action.dodged ? {} : { ...action.effects };
  if (action.fatal) {
    // Không ai kéo lại được: y tá che chở cũng vô ích, ghi đúng số Máu mất để kể lại.
    effects.hp = -p.hp;
    p.hp = 0;
    p.protected = false;
  }
  if (effects.hp && !action.fatal) p.hp = clamp(p.hp + limit(effects.hp), 0, p.maxHp);
  if (effects.morale) p.morale = clamp(p.morale + limit(effects.morale), 0, 100);
  if (effects.hunger) p.hunger = clamp(p.hunger + limit(effects.hunger), 0, 100);
  if (effects.stamina) p.stamina = clamp(p.stamina + limit(effects.stamina), 0, 100);
  if (effects.food) state.food = Math.max(0, state.food + limit(effects.food));
  if (effects.treasure) state.treasure = clamp(state.treasure + Math.max(0, limit(effects.treasure)), 0, 100);
  // Balo đầy thì món nhặt được phải bỏ lại.
  const gained = effects.gainItem && gainItem(state, p, effects.gainItem, config) ? effects.gainItem : null;

  if (action.once) state.discovered.push(action.refId);
  state.log.push({
    kind: "encounter",
    day: state.day,
    playerId: p.id,
    source: action.source,
    refId: action.refId,
    defId: action.defId,
    effects,
    gained,
    dodged: action.dodged ?? false,
  });
  return checkDeaths(state);
}
