// Kể chuyện từ sự thật: mọi câu đều dựa trên những gì engine đã ghi (ai đi đâu, xúc xắc ra sao,
// ai ngủ ngoài, ai bị trói) và cốt truyện của ván. Bộ sinh không bao giờ tự bịa ra kết quả.

import {
  BACKGROUND_LABELS,
  ENDING_LABELS,
  FLAW_LABELS,
  ROLE_LABELS,
  ZONE_LABELS,
  content,
  worldCatalog,
  type StoryElement,
  type StoryLibrary,
} from "@tentides/content";
import { TOTAL_DAYS, TWIST_DAY, isTraitor, twistVolcano, type GameConfig, type GameState, type IncidentEffect, type LogEntry } from "@tentides/rules";
import type { Premise } from "./premise.ts";
import { Voice, capitalize, fill, joinNames, uncapitalize } from "./text.ts";

export interface StoryContext {
  seed: number;
  premise: Premise;
  library: StoryLibrary;
  state: GameState;
  config: GameConfig;
}

/** Danh hiệu cuối ván (server tính từ những gì người chơi làm trên đảo), để biên niên sử nhắc tới. */
export interface Award {
  playerId: string;
  title: string;
  detail: string;
}

export interface Chronicle {
  title: string;
  paragraphs: string[];
}

class Teller {
  constructor(
    private readonly ctx: StoryContext,
    readonly voice: Voice,
  ) {}

  element(id: string): StoryElement {
    const e = this.ctx.library.elements.find((x) => x.id === id);
    if (!e) throw new Error(`Không có yếu tố truyện "${id}"`);
    return e;
  }

  /** Giá trị dùng chung cho mọi mẫu câu. */
  get base(): Record<string, string> {
    const p = this.ctx.premise;
    return {
      hider: this.element(p.hider).name ?? "",
      motive: this.element(p.motive).name ?? "",
      treasure: this.element(p.treasure).name ?? "",
      secret: uncapitalize(this.element(p.secret).name ?? ""),
      player: p.twistPlayer ? this.name(p.twistPlayer) : "",
    };
  }

  name(playerId: string): string {
    return this.ctx.state.players[playerId]?.name ?? "?";
  }

  line(key: string, vars: Record<string, string | number> = {}): string {
    const variants = this.ctx.library.templates[key];
    if (!variants) throw new Error(`Thiếu nhóm mẫu câu "${key}"`);
    return capitalize(fill(this.voice.pick(variants), { ...this.base, ...vars }));
  }

  elementLine(id: string, vars: Record<string, string | number> = {}): string {
    return capitalize(fill(this.voice.pick(this.element(id).lines), { ...this.base, ...vars }));
  }
}

function allEntries<K extends LogEntry["kind"]>(state: GameState, kind: K): Extract<LogEntry, { kind: K }>[] {
  return state.log.filter((e): e is Extract<LogEntry, { kind: K }> => e.kind === kind);
}

function entriesOf<K extends LogEntry["kind"]>(state: GameState, kind: K, day: number): Extract<LogEntry, { kind: K }>[] {
  return allEntries(state, kind).filter((e) => e.day === day);
}

function itemName(config: GameConfig, id: string): string {
  return (config.items.find((i) => i.id === id)?.name ?? id).toLocaleLowerCase("vi");
}

function incidentText(t: Teller, config: GameConfig, e: IncidentEffect): string {
  switch (e.type) {
    case "hull":
      return "thuyền bị hư hại một mảng";
    case "repair":
      return "thuyền đã được ai đó vá thêm trong đêm";
    case "food":
      return "kho lương thực hụt mất một khẩu phần";
    case "treasure":
      return "vài manh mối kho báu hóa ra sai bét";
    case "itemMissing":
      return `${itemName(config, e.itemId)} của ${t.name(e.playerId)} không cánh mà bay`;
    case "strangeLight":
      return "có ánh lửa lạ lập lòe ngoài khơi";
    case "rescued":
      return `${t.name(e.playerId)} suýt chết nhưng được cứu kịp`;
  }
}

/** Tên (viết thường) của thứ được chạm trán: easter egg, điểm bất thường, bẫy hay sinh vật. */
function encounterThing(defId: string): string {
  const name =
    worldCatalog.pois.get(defId)?.name ??
    worldCatalog.traps.get(defId)?.name ??
    worldCatalog.creatures.get(defId)?.name ??
    worldCatalog.buildings.get(defId)?.name ??
    content.items.get(defId)?.name ??
    (defId === "fists" ? "nắm đấm" : "điều lạ");
  return name.toLocaleLowerCase("vi");
}

/** Một câu kể cho một lần chạm trán ngoài bản đồ. */
function encounterLine(t: Teller, e: Extract<LogEntry, { kind: "encounter" }>): string {
  const vars = { name: t.name(e.playerId), thing: encounterThing(e.defId) };
  const bad = Object.values(e.effects).some((v) => typeof v === "number" && v < 0);
  switch (e.source) {
    case "egg":
      return t.line("encounter_egg", vars);
    case "anomaly":
      return t.line(bad ? "encounter_anomaly_bad" : "encounter_anomaly_good", vars);
    case "trap":
      return t.line(e.dodged ? "encounter_trap_dodged" : "encounter_trap", vars);
    case "creature":
      return t.line("encounter_creature", vars);
    case "friend":
      return t.line("encounter_friend", vars);
    case "drowning":
      return t.line("encounter_drown", vars);
    case "attack":
      return t.line("encounter_attack", { ...vars, thing: encounterThing(e.defId) });
    case "fall":
      return t.line("encounter_fall", vars);
    case "hunt":
      return t.line("encounter_hunt", vars);
    case "page":
      return t.line("page_found", vars);
    case "lava":
      return t.line("encounter_lava", vars);
    case "burn":
      return t.line("encounter_burn", vars);
  }
}

/** Câu kể một người gục: chết vì dung nham, đuối nước hay lửa thì kể đúng như thế. */
function deathLine(t: Teller, state: GameState, e: Extract<LogEntry, { kind: "death" }>): string {
  const index = state.log.indexOf(e);
  const before = state.log.slice(0, index < 0 ? state.log.length : index).reverse();
  const last = before.find((x) => x.kind === "encounter" && x.playerId === e.playerId && x.day === e.day);
  const cause = last?.kind === "encounter" && (last.effects.hp ?? 0) < 0 ? last.source : "";
  const causes: Record<string, string> = { lava: "death_lava", drowning: "death_drown", burn: "death_burn" };
  const key = causes[cause];
  return t.line(key ?? "death", { name: t.name(e.playerId) });
}

/** Tên chuyện đêm ngủ ngoài (viết thường), để chèn vào câu. */
function outsideTitle(config: GameConfig, id: string): string {
  return (config.outsideEvents?.find((e) => e.id === id)?.title ?? "khó ngủ").toLocaleLowerCase("vi");
}

/** Bản kể bình minh: truyền thuyết (ngày đầu), thời tiết, núi lửa, điềm báo, nhân vật phụ, twist, chuyện đêm qua, ai đang ra sao. */
export function narrateDawn(ctx: StoryContext, day: number): string[] {
  const t = new Teller(ctx, new Voice(ctx.seed, "dawn", day));
  const { state, premise } = ctx;
  const out: string[] = [];

  if (day === 1) {
    out.push(t.line("premise"), t.elementLine(premise.hider), t.line("secret_intro"));
  }
  const weather = state.weather[day - 1];
  const weatherLine = ctx.library.elements.find((e) => e.category === "weather" && e.weather === weather);
  out.push(`${t.line("day_open", { day })} ${weatherLine ? t.elementLine(weatherLine.id) : ""}`.trim());
  // Núi lửa thức dần theo ngày (mức lúc bình minh là số ngày × 10, cộng thêm nếu biến cố làm nó tỉnh sớm).
  const volcano = day * 10 + twistVolcano({ twist: state.twist, day });
  out.push(t.line(volcano <= 30 ? "volcano_calm" : volcano <= 60 ? "volcano_stirring" : "volcano_angry"));

  // Điềm báo mở đầu mỗi hồi.
  const act = day <= 3 ? 1 : day <= 7 ? 2 : 3;
  if (day === 1 || day === 4 || day === 8) out.push(t.elementLine(premise.omens[act - 1]!));
  // Nhân vật phụ và vật chứng xuất hiện rải rác.
  const npcDay = { 2: premise.npcs[0], 6: premise.npcs[1] }[day];
  if (npcDay) out.push(t.line("npc_meet", { npc: t.element(npcDay).name ?? "", npcLine: t.elementLine(npcDay, { npc: t.element(npcDay).name ?? "" }) }));
  const relicDay = { 3: premise.relics[0], 7: premise.relics[1] }[day];
  const alive = state.playerOrder.filter((id) => state.players[id]!.alive);
  if (relicDay && alive.length > 0) {
    const relic = t.element(relicDay);
    out.push(t.line("relic_found", { finder: t.name(t.voice.pick(alive)), relic: relic.name ?? "", relicLine: t.elementLine(relicDay, { relic: relic.name ?? "" }) }));
  }
  if (day === TWIST_DAY) {
    out.push(t.line("twist_intro", { twist: t.elementLine(premise.twist) }));
    // Hệ quả thật của biến cố (engine đã áp): chỉ kể khi biến cố đã thực sự xảy ra trong nhật ký.
    const happened = entriesOf(state, "twist", day)[0];
    const key = `twist_effect_${happened?.twist ?? ""}`;
    if (happened && ctx.library.templates[key]) out.push(t.line(key, { player: happened.playerId ? t.name(happened.playerId) : "" }));
  }
  if (day === TOTAL_DAYS) out.push(t.line("last_day"));

  // Chuyện đêm qua.
  const night = entriesOf(state, "night", day - 1)[0];
  if (night?.tied) out.push(t.line("night_recap_tie", { name: t.name(night.tied) }));
  else if (night?.nominee) out.push(t.line("night_recap_tie_failed", { name: t.name(night.nominee) }));
  if (night && night.ration !== "normal") {
    out.push(t.line("night_recap_hungry", { ration: night.ration === "half" ? "ăn dè, hai người chung một phần" : "nhịn đói để giữ kho" }));
  }
  for (const e of entriesOf(state, "outside", day - 1)) {
    out.push(t.line("outside_recap", { name: t.name(e.playerId), event: outsideTitle(ctx.config, e.event) }));
  }
  const incidents = entriesOf(state, "incident", day - 1).flatMap((e) => e.effects);
  if (incidents.length > 0) {
    out.push(t.line("incident_intro", { incidents: incidents.map((e) => incidentText(t, ctx.config, e)).join(", ") }));
  }

  // Ai đang ra sao.
  for (const e of entriesOf(state, "death", day - 1)) out.push(t.line("status_gone", { name: t.name(e.playerId) }));
  // Gộp tình trạng theo nhóm, để không lặp một câu cho từng người.
  const tied = alive.filter((id) => state.players[id]!.tied);
  const hurt = alive.filter((id) => !tied.includes(id) && state.players[id]!.hp < state.players[id]!.maxHp * 0.4);
  const hungry = alive.filter((id) => !tied.includes(id) && !hurt.includes(id) && state.players[id]!.hunger <= 20);
  for (const id of tied) out.push(t.line("status_tied", { name: t.name(id) }));
  const names = (ids: string[]) => joinNames(ids.map((id) => t.name(id)));
  if (hurt.length > 0) out.push(t.line("status_hurt", { names: names(hurt) }));
  if (hungry.length > 0) out.push(t.line("status_hungry", { names: names(hungry) }));
  return out;
}

/** Bản kể hoàng hôn: kể lại cả ngày từ nhật ký xúc xắc, việc đào kho báu, cái chết, ai ngủ ngoài. */
export function narrateDusk(ctx: StoryContext, day: number): string[] {
  const t = new Teller(ctx, new Voice(ctx.seed, "dusk", day));
  const { state, config } = ctx;
  const out: string[] = [];
  const checks = entriesOf(state, "check", day);
  const zones: string[] = [];

  for (const e of checks) {
    const card = config.cards.find((c) => c.id === e.cardId);
    const zone = config.anchors.find((a) => a.id === e.anchorId)?.zone;
    if (zone) zones.push(zone);
    const helper = e.result.modifiers.find((m) => m.value > 0 && config.items.some((i) => i.name === m.label));
    const help = e.result.success && helper ? fill(t.voice.pick(ctx.library.templates.help_item!), { item: helper.label.toLowerCase() }) : "";
    const names = e.participants.map((id) => t.name(id));
    const vars = { name: names[0]!, names: joinNames(names), title: card?.title ?? e.cardId, zone: zone ? ZONE_LABELS[zone].toLowerCase() : "đâu đó", help };
    const group = names.length > 1 ? "group" : "solo";
    out.push(t.line(`check_${e.result.success ? "success" : "fail"}_${group}`, vars));
  }
  if (checks.length === 0) out.push(t.line("quiet_day"));
  if (zones.length > 0) {
    const zone = t.voice.pick(zones);
    const atmosphere = ctx.library.elements.filter((e) => e.category === "atmosphere" && e.zone === zone);
    if (atmosphere.length > 0) out.push(t.elementLine(t.voice.pick(atmosphere).id));
  }
  // Chạm trán ngoài bản đồ: mỗi người, mỗi loại chỉ kể một lần trong ngày (con vật cắn ba lần vẫn là một chuyện),
  // và tối đa bốn chuyện để lời kể hoàng hôn không dài lê thê.
  const told = new Set<string>();
  for (const e of entriesOf(state, "encounter", day)) {
    const key = `${e.playerId}:${e.source}:${e.defId}`;
    if (told.has(key) || told.size >= 4) continue;
    told.add(key);
    out.push(encounterLine(t, e));
  }
  for (const e of entriesOf(state, "build", day)) out.push(t.line("build", { name: t.name(e.playerId), thing: encounterThing(e.building) }));
  const stashed = entriesOf(state, "stash", day);
  if (stashed.length > 0) {
    const names = [...new Set(stashed.map((e) => t.name(e.playerId)))];
    const items = [...new Set(stashed.map((e) => itemName(config, e.itemId)))];
    out.push(t.line("stash", { names: joinNames(names), items: joinNames(items) }));
  }
  const crafted = entriesOf(state, "craft", day);
  if (crafted.length > 0) {
    const names = [...new Set(crafted.map((e) => t.name(e.playerId)))];
    const items = [...new Set(crafted.map((e) => itemName(config, e.itemId).toLowerCase()))];
    out.push(t.line("craft", { names: joinNames(names), items: joinNames(items) }));
  }
  const repaired = entriesOf(state, "repair", day);
  if (repaired.length > 0) out.push(t.line("repair", { names: joinNames([...new Set(repaired.map((e) => t.name(e.playerId)))]) }));
  for (const e of entriesOf(state, "dig", day)) out.push(t.line("dig", { name: t.name(e.playerId) }));
  for (const e of entriesOf(state, "death", day)) out.push(deathLine(t, state, e));
  const dusk = entriesOf(state, "dusk", day)[0];
  if (dusk && dusk.sleptOutside.length > 0) out.push(t.line("slept_outside", { names: joinNames(dusk.sleptOutside.map((id) => t.name(id))) }));
  out.push(t.line("dusk_close"));
  return out;
}

/** Lời kể riêng mỗi sáng, viết ở ngôi "bạn": dòng tự mô tả, xuất thân, tật xấu, quan hệ, vai ẩn, tình trạng. */
export function narratePrivate(ctx: StoryContext, playerId: string, day: number): string[] {
  const t = new Teller(ctx, new Voice(ctx.seed, "private", playerId, day));
  const p = ctx.state.players[playerId];
  if (!p || !p.alive) return [];
  const out: string[] = [];
  const bg = BACKGROUND_LABELS[p.background];
  const flaw = FLAW_LABELS[p.flaw];

  if (day === 1) {
    out.push(p.bio ? t.line("private_bio", { bio: p.bio }) : t.line("private_background", { background: bg.title.toLowerCase(), hook: t.voice.pick(bg.hooks) }));
    for (const b of ctx.premise.bonds.filter((x) => x.a === playerId || x.b === playerId)) {
      out.push(t.elementLine(b.bond, { a: t.name(b.a), b: t.name(b.b) }));
    }
  } else if (day % 3 === 0) {
    out.push(t.line("private_flaw", { hook: t.voice.pick(flaw.hooks) }));
  } else if (day % 3 === 2) {
    out.push(t.line("private_background", { background: bg.title.toLowerCase(), hook: t.voice.pick(bg.hooks) }));
  }
  // Đêm qua ngủ ngoài: kể lại đúng chuyện đã xảy ra với mình.
  for (const e of entriesOf(ctx.state, "outside", day - 1).filter((x) => x.playerId === playerId)) {
    const event = ctx.config.outsideEvents?.find((x) => x.id === e.event);
    if (event) out.push(t.line("private_outside", { event: event.title.toLocaleLowerCase("vi"), text: e.result.success ? event.successText : event.failText }));
  }
  if (day === TWIST_DAY && entriesOf(ctx.state, "twist", day).some((e) => e.playerId === playerId)) out.push(t.line("private_twist"));
  if (isTraitor(p.role) && day % 2 === 1) out.push(t.line("private_traitor"));
  if (p.role === "nurse" && day % 2 === 0) out.push(t.line("private_nurse"));
  if (p.hp < p.maxHp * 0.4) out.push(t.line("private_hurt"));
  else if (p.hunger <= 20) out.push(t.line("private_hungry"));
  return out;
}

/**
 * Trang nhật ký rải trên đảo, mỗi ngày một trang: mỗi trang hé thêm một mảnh cốt truyện của ván
 * (người giấu, động cơ, vật chứng, bí mật của đảo, kho báu...). Không bao giờ lộ vai ẩn hay biến cố trước ngày 5.
 */
export function diaryPage(ctx: StoryContext, day: number): { title: string; text: string } {
  const t = new Teller(ctx, new Voice(ctx.seed, "page", day));
  const p = ctx.premise;
  const order = [p.hider, p.motive, p.relics[0], p.secret, p.treasure, p.npcs[1], p.relics[1], p.secret, p.motive, p.treasure];
  const id = order[(Math.max(1, day) - 1) % order.length]!;
  const e = t.element(id);
  const vars = { relic: e.category === "relic" ? (e.name ?? "") : "", npc: e.category === "npc" ? (e.name ?? "") : "" };
  // Câu của yếu tố viết ở giọng người kể; trang nhật ký trích lại nguyên văn.
  return { title: t.line("page_title"), text: t.line("page_text", { line: t.elementLine(id, vars) }) };
}

/** Biên niên sử một trang: tên đoàn, truyền thuyết, thành viên, khoảnh khắc đáng nhớ, kẻ phản bội, lời kết. */
export function chronicle(ctx: StoryContext, awards: readonly Award[] = []): Chronicle {
  const t = new Teller(ctx, new Voice(ctx.seed, "chronicle"));
  const { state, config, premise } = ctx;
  const crew = `Đoàn ${t.voice.pick(ctx.library.templates.crew_adj!)}`;
  const paragraphs: string[] = [t.line("premise")];

  paragraphs.push(
    state.playerOrder
      .map((id) => {
        const p = state.players[id]!;
        return t.line("chronicle_members", {
          name: p.name,
          background: BACKGROUND_LABELS[p.background].title.toLowerCase(),
          flaw: FLAW_LABELS[p.flaw].title.toLowerCase(),
          bio: p.bio ? `, người lên đường vì ${p.bio}` : "",
        });
      })
      .join(" "),
  );

  const moments: string[] = [];
  const checks = allEntries(state, "check");
  const dramatic = [...checks].sort((a, b) => Math.abs(b.result.roll - 10.5) - Math.abs(a.result.roll - 10.5))[0];
  if (dramatic) {
    const card = config.cards.find((c) => c.id === dramatic.cardId);
    moments.push(
      t.line("chronicle_moment_roll", {
        name: t.name(dramatic.playerId),
        roll: dramatic.result.roll,
        title: card?.title ?? "",
        outcome: dramatic.result.success ? "cả đoàn vỡ òa" : "cả đoàn nín thở",
      }),
    );
  }
  if (state.day >= 5) moments.push(t.elementLine(premise.twist));
  for (const e of allEntries(state, "dig")) moments.push(t.line("dig", { name: t.name(e.playerId) }));
  for (const e of allEntries(state, "death")) moments.push(deathLine(t, state, e));
  const secrets = allEntries(state, "encounter").filter((e) => e.source === "egg");
  if (secrets.length > 0) {
    const things = [...new Set(secrets.map((e) => encounterThing(e.defId)))];
    moments.push(t.line("chronicle_discoveries", { count: secrets.length, things: joinNames(things.slice(0, 4)) }));
  }
  if (awards.length > 0) {
    const lines = awards.slice(0, 4).map((a) => fill(t.voice.pick(ctx.library.templates.award_line!), { name: t.name(a.playerId), title: a.title.toLocaleLowerCase("vi"), detail: a.detail }));
    moments.push(t.line("chronicle_awards", { awards: lines.join("; ") }));
  }
  if (moments.length > 0) paragraphs.push(moments.join(" "));

  const traitor = Object.values(state.players).find((p) => isTraitor(p.role));
  paragraphs.push(
    traitor
      ? t.line("chronicle_traitor", { name: traitor.name, role: ROLE_LABELS[traitor.role].title.toLowerCase() })
      : t.line("chronicle_no_traitor"),
  );

  if (state.ending) {
    const epilogue = ctx.library.elements.find((e) => e.category === "epilogue" && e.ending === state.ending);
    const codas = ctx.library.elements.filter((e) => e.category === "epilogue" && e.ending === "*");
    const closing = [epilogue ? t.elementLine(epilogue.id, { crew }) : ENDING_LABELS[state.ending].text];
    if (codas.length > 0) closing.push(t.elementLine(t.voice.pick(codas).id, { crew }));
    paragraphs.push(closing.join(" "));
  }
  return { title: crew, paragraphs };
}
