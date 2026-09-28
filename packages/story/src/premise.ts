// Cốt truyện của một ván: seed chọn một tổ hợp yếu tố từ thư viện (người giấu, động cơ, kho báu,
// bí mật của đảo, nhân vật phụ, điềm báo, twist ngày 5, vật chứng, quan hệ giữa người chơi).

import type { StoryElement, StoryLibrary } from "@tentides/content";
import { Voice } from "./text.ts";

export interface Premise {
  hider: string;
  motive: string;
  treasure: string;
  secret: string;
  npcs: [string, string];
  /** Điềm báo cho từng hồi (1, 2, 3). */
  omens: [string, string, string];
  twist: string;
  relics: [string, string];
  /** Quan hệ giữa từng cặp người chơi: vài cặp ngẫu nhiên, mỗi cặp một quan hệ. */
  bonds: { a: string; b: string; bond: string }[];
  /** Người chơi xuất hiện trong twist (nếu twist nhắc tới một người chơi). */
  twistPlayer: string | null;
}

function byCategory(library: StoryLibrary, category: StoryElement["category"]): StoryElement[] {
  return library.elements.filter((e) => e.category === category);
}

/** Lấy n phần tử khác nhau. */
function draw<T>(voice: Voice, pool: readonly T[], n: number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length > 0) out.push(left.splice(Math.floor(voice.float() * left.length), 1)[0]!);
  return out;
}

export function createPremise(seed: number, playerIds: readonly string[], library: StoryLibrary): Premise {
  const voice = new Voice(seed, "premise");
  const hider = voice.pick(byCategory(library, "hider"));
  // Động cơ phải hợp với người giấu (vd. "chôn cùng người yêu" cần người giấu có thẻ tình yêu).
  const motives = byCategory(library, "motive").filter((m) => !m.requiresAnyTag || m.requiresAnyTag.some((t) => hider.tags.includes(t)));
  const motive = voice.pick(motives);
  const omenFor = (act: number) => voice.pick(byCategory(library, "omen").filter((o) => o.act === act)).id;
  const [npcA, npcB] = draw(voice, byCategory(library, "npc"), 2) as [StoryElement, StoryElement];
  const [relicA, relicB] = draw(voice, byCategory(library, "relic"), 2) as [StoryElement, StoryElement];
  const twist = voice.pick(byCategory(library, "twist"));

  const pairs: [string, string][] = [];
  for (let i = 0; i < playerIds.length; i++) for (let j = i + 1; j < playerIds.length; j++) pairs.push([playerIds[i]!, playerIds[j]!]);
  const bondCount = Math.min(pairs.length, Math.ceil(playerIds.length / 2));
  const chosenPairs = draw(voice, pairs, bondCount);
  const bondElements = draw(voice, byCategory(library, "bond"), bondCount);
  const bonds = chosenPairs.map(([x, y], i) => {
    const [a, b] = voice.chance(0.5) ? [x, y] : [y, x];
    return { a, b, bond: bondElements[i]!.id };
  });

  return {
    hider: hider.id,
    motive: motive.id,
    treasure: voice.pick(byCategory(library, "treasure")).id,
    secret: voice.pick(byCategory(library, "secret")).id,
    npcs: [npcA.id, npcB.id],
    omens: [omenFor(1), omenFor(2), omenFor(3)],
    twist: twist.id,
    relics: [relicA.id, relicB.id],
    bonds,
    twistPlayer: twist.lines.some((l) => l.includes("{player}")) && playerIds.length > 0 ? voice.pick(playerIds) : null,
  };
}
