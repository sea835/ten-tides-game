import type { Client } from "@colyseus/core";
import {
  ASSASSINATE_RADIUS,
  BUILD_RADIUS,
  CAMP,
  CAMP_RADIUS,
  CLIMB_REACH,
  FALL_DAMAGE_MAX,
  FALL_DAMAGE_PER_M,
  PICKUP_RADIUS,
  TIDE_MEAN,
  UNARMED_CHOP,
  content,
  meleeOf,
  snapFromRecord,
  snapOffset,
  snapPiece,
  snapProblem,
  snapReach,
  snapTerrain,
  snapY,
  worldCatalog,
  type BuildingDef,
  type SnapPiece,
  type World,
} from "@tentides/content";
import {
  AssassinateMessage,
  AttackMessage,
  BuildMessage,
  BuildingState,
  ClimbMessage,
  GroundItemState,
  CraftMessage,
  GiveMessage,
  HoldMessage,
  Messages,
  PickupMessage,
  PlantState,
  ProjectileState,
  ThrowMessage,
  UseMessage,
  type CorrectMessage,
  type EncounterMessage,
  type FxMessage,
  type IslandState,
  type KnockMessage,
} from "@tentides/protocol";
import { ENCOUNTER_PHASES, canAssassinate, hasMaterials, type EncounterEffects, type EncounterSource, type GameAction, type GameState } from "@tentides/rules";
import { Play, pickTarget, type Target } from "./play.ts";
import type { Feat, Feats } from "./awards.ts";
import type { Wildlife } from "./wildlife.ts";

// Nối hệ thống tương tác (play.ts) vào phòng chơi: nhận lệnh của người chơi, kiểm tra, đưa hệ quả vào engine luật,
// rồi chép phần công khai sang state để mọi máy vẽ lại. Hiệu ứng hình ảnh (trúng đòn, cây đổ...) gửi qua message `fx`.

/** Những gì phòng chơi cho hệ thống tương tác dùng. */
export interface PlayHost {
  readonly state: IslandState;
  game(): GameState;
  world(): World;
  wildlife(): Wildlife;
  playerOf(client: Client): string | undefined;
  clientOf(playerId: string): Client | undefined;
  dispatch(action: GameAction, client?: Client): boolean;
  reject(client: Client, reason: string): void;
  broadcast(type: string, message: unknown): void;
  encounter(
    playerId: string,
    source: EncounterSource,
    refId: string,
    defId: string,
    effects: EncounterEffects,
    opts: { once?: boolean; dodged?: boolean },
    message: { title: string; text: string },
  ): boolean;
  onMessage<T>(type: string, schema: { parse(v: unknown): T }, handler: (client: Client, message: T) => void): void;
  onMessage(type: string, handler: (client: Client) => void): void;
}

/** Bị đánh tay không hoặc bằng đồ không phải vũ khí thì đẩy lùi ít; vũ khí nặng đẩy lùi mạnh. */
const KNOCK = 3.5;
/** Giết thú hiền thì áy náy. */
const HUNT_FRIEND_MORALE = -8;
/** Bơi ngoài khơi lâu chừng này giây thì bắt đầu có cá mập để ý; mỗi giây sau đó có chừng này cơ hội một con tìm tới. */
const SHARK_AFTER = 8;
const SHARK_CHANCE_PER_SECOND = 0.05;
const TOLERANCE = 1.5;
/** Đứng cách nhau chừng này thì trao tay được. */
export const GIVE_RADIUS = 2.5;
/** Đứng cách lửa trại chừng này thì nướng, góp kho được. */
export const CAMPFIRE_REACH = 4;

export class PlayController {
  play: Play;
  private seaTime = new Map<string, number>();
  private synced = { stumps: "", camp: "" };

  constructor(
    private readonly host: PlayHost,
    world: World,
    seed: number,
  ) {
    this.play = new Play(world, seed);
  }

  /** Đổi bản đồ ở sảnh chờ: làm lại từ đầu (giữ vị trí trại mặc định). */
  reset(world: World, seed: number) {
    this.play = new Play(world, seed);
    const s = this.host.state;
    s.groundItems.clear();
    s.projectiles.clear();
    s.plants.clear();
    s.stumps.clear();
    s.buildings.clear();
    this.synced = { stumps: "", camp: "" };
  }

  /** Trại hiện tại, cho sinh vật (vùng an toàn) và cho việc tính ai về kịp trại. */
  camp(): { x: number; z: number; radius: number } {
    return { x: this.play.camp.x, z: this.play.camp.z, radius: CAMP_RADIUS };
  }

  /** Cây thú trèo được. */
  perches() {
    return this.play.standingTrees().filter((t) => this.play.climbable(t));
  }

  /** Những gì từng người làm trên đảo, để trao danh hiệu cuối ván. */
  readonly feats = new Map<string, Feats>();

  private feat(playerId: string, feat: Feat, n = 1) {
    const f = this.feats.get(playerId) ?? {};
    f[feat] = (f[feat] ?? 0) + n;
    this.feats.set(playerId, f);
  }

  register() {
    const h = this.host;
    h.onMessage(Messages.hold, HoldMessage, (client, { uid }) => this.onHold(client, uid));
    h.onMessage(Messages.attack, AttackMessage, (client, m) => this.onAttack(client, m.yaw, m.pitch));
    h.onMessage(Messages.throw, ThrowMessage, (client, m) => this.onThrow(client, m.yaw, m.pitch, m.power));
    h.onMessage(Messages.drop, (client) => this.onDrop(client));
    h.onMessage(Messages.give, GiveMessage, (client, { target }) => this.onGive(client, target));
    h.onMessage(Messages.craft, CraftMessage, (client, { itemId }) => this.onCraft(client, itemId));
    h.onMessage(Messages.use, UseMessage, (client, m) => this.onUse(client, m.x, m.z));
    h.onMessage(Messages.pickup, PickupMessage, (client, { id }) => this.onPickup(client, id));
    h.onMessage(Messages.climb, ClimbMessage, (client, { treeId }) => this.onClimb(client, treeId));
    h.onMessage(Messages.packCamp, (client) => this.onPackCamp(client));
    h.onMessage(Messages.campfire, (client) => this.onCampfire(client));
    h.onMessage(Messages.build, BuildMessage, (client, m) => this.onBuild(client, m.kind, m.x, m.z, m.rot, m.level ?? 0));
    h.onMessage(Messages.assassinate, AssassinateMessage, (client, { target }) => this.onAssassinate(client, target));
  }

  // ------------------------------------------------------------------ kiểm tra chung

  /** Người gửi lệnh: phải đang trong giờ đi lại, còn sống, không choáng, không bị trói, không kẹt trong sự kiện. */
  private actor(client: Client, opts: { allowTied?: boolean; allowStun?: boolean } = {}) {
    const h = this.host;
    const id = h.playerOf(client);
    const player = id && h.state.players.get(id);
    const sheet = id ? h.game().players[id] : undefined;
    if (!id || !player || !sheet || h.state.paused) return null;
    if (!ENCOUNTER_PHASES.includes(h.game().phase)) {
      h.reject(client, "Lúc này chưa làm được việc đó.");
      return null;
    }
    if (!sheet.alive) return null;
    if (sheet.tied && !opts.allowTied) {
      h.reject(client, "Bạn đang bị trói.");
      return null;
    }
    if (!opts.allowStun && this.play.stunned(id)) return null;
    const busy = Object.values(h.game().anchors).some((a) => a.status === "active" && a.participants.includes(id));
    if (busy) {
      h.reject(client, "Đang bận với sự kiện trước mặt.");
      return null;
    }
    return { id, player, sheet };
  }

  private heldItem(id: string): { uid: string; itemId: string } | null {
    const uid = this.play.held.get(id);
    if (!uid) return null;
    const entry = this.host.game().players[id]?.bag.find((b) => b.uid === uid);
    return entry ? { uid, itemId: entry.itemId } : null;
  }

  private act(id: string, act: string) {
    const p = this.host.state.players.get(id);
    if (!p) return;
    p.act = act;
    p.actN = (p.actN + 1) % 65000;
  }

  private fx(message: FxMessage) {
    this.host.broadcast(Messages.fx, message);
  }

  /** Người và thú có thể bị đánh trúng. */
  private targets(exclude: string): Target[] {
    const h = this.host;
    const out: Target[] = [];
    for (const [id, p] of h.state.players) {
      if (id === exclude || !p.connected || !h.game().players[id]?.alive) continue;
      out.push({ kind: "player", id, x: p.x, y: p.y, z: p.z });
    }
    for (const c of h.wildlife().active(h.game().day)) out.push({ kind: "creature", id: c.id, x: c.x, y: c.y, z: c.z });
    return out;
  }

  // ------------------------------------------------------------------ cầm, đánh, ném

  private onHold(client: Client, uid: string) {
    const id = this.host.playerOf(client);
    if (!id) return;
    if (!uid) {
      this.play.held.delete(id);
      return;
    }
    if (!this.host.game().players[id]?.bag.some((b) => b.uid === uid)) return this.host.reject(client, "Món này không có trong balo.");
    this.play.held.set(id, uid);
  }

  private onAttack(client: Client, yaw: number, pitch: number) {
    const a = this.actor(client);
    if (!a) return;
    const held = this.heldItem(a.id);
    const def = held ? content.items.get(held.itemId) : undefined;
    const ranged = def?.ranged;
    const stats = ranged ?? meleeOf(held?.itemId);
    if (!this.play.ready(a.id, stats.cooldown)) return;
    this.act(a.id, ranged ? "shoot" : "swing");
    const from = { x: a.player.x, y: a.player.y, z: a.player.z };
    if (ranged) this.fx({ kind: "shoot", x: from.x - Math.sin(yaw) * 0.8, y: from.y + 1.4, z: from.z - Math.cos(yaw) * 0.8, word: ranged.word, dir: yaw });
    const reach = ranged ? ranged.range : meleeOf(held?.itemId).reach;
    const target = pickTarget(from, yaw, pitch, reach, this.targets(a.id), !!ranged);
    if (target) {
      this.hit(a.id, target, stats, held?.itemId ?? "fists", { x: from.x, z: from.z });
      return;
    }
    if (!ranged) this.chopOrMiss(a.id, from, yaw, held?.itemId);
  }

  /** Đánh trúng người hoặc thú: trừ Máu (qua engine với người), gây hiệu ứng, đẩy lùi, hiện chữ. */
  private hit(attacker: string, target: Target, stats: { damage: number; word?: string; stun?: number; dizzy?: number; blind?: number }, weapon: string, from: { x: number; z: number }) {
    const h = this.host;
    const word = stats.word ?? "BỐP!";
    const status = { stun: stats.stun, dizzy: stats.dizzy, blind: stats.blind };
    if (target.kind === "player") {
      const attackerName = h.state.players.get(attacker)?.name ?? "Ai đó";
      const weaponName = weapon === "fists" ? "nắm đấm" : (content.items.get(weapon)?.name.toLowerCase() ?? "một vật gì đó");
      if (stats.damage > 0) {
        this.feat(attacker, "damage", stats.damage);
        this.feat(target.id, "hurt", stats.damage);
        h.encounter(target.id, "attack", attacker, weapon, { hp: -stats.damage }, {}, {
          title: `${attackerName} đánh bạn!`,
          text: `Một đòn ${weaponName} trúng người bạn. Đau điếng.`,
        });
      }
      this.play.applyStatus(target.id, status);
      const d = Math.hypot(target.x - from.x, target.z - from.z) || 1;
      h.clientOf(target.id)?.send(Messages.knock, {
        dx: (target.x - from.x) / d,
        dz: (target.z - from.z) / d,
        force: KNOCK * (0.5 + stats.damage / 20),
      } satisfies KnockMessage);
      this.fx({ kind: "hit", x: target.x, y: target.y + 1.6, z: target.z, word, amount: stats.damage });
      return;
    }
    const wildlife = h.wildlife();
    const creature = wildlife.find(target.id);
    if (!creature) return;
    const kill = wildlife.damage(target.id, stats.damage, { id: attacker, x: from.x, z: from.z }, stats.stun ?? 0);
    this.fx({ kind: "hit", x: target.x, y: target.y + 0.8, z: target.z, word, amount: stats.damage });
    if (!kill) return;
    this.feat(attacker, "beasts");
    this.fx({ kind: "poof", x: creature.x, y: creature.y + 0.5, z: creature.z, word: "PHỰT!" });
    // Thú chết dưới nước thì đồ chìm xuống đáy; trên cây thì rơi xuống gốc.
    this.play.scatter(kill.drops, creature.x, creature.z);
    if (creature.def.temper === "friendly") {
      h.encounter(attacker, "hunt", creature.id, creature.def.id, { morale: HUNT_FRIEND_MORALE }, {}, {
        title: `Bạn đã giết ${creature.def.name.toLowerCase()}`,
        text: "Nó từng quấn quýt theo chân người. Giờ thì nằm im. Bạn thấy lòng nặng trĩu.",
      });
    }
  }

  /** Không trúng ai thì chém vào cây trước mặt (nếu có), không thì chém gió. */
  private chopOrMiss(id: string, from: { x: number; y: number; z: number }, yaw: number, itemId: string | undefined) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: { id: string; x: number; z: number; d: number } | null = null;
    for (const t of this.play.standingTrees()) {
      const dx = t.x - from.x;
      const dz = t.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.3 || (d > 0.5 && (dx * fx + dz * fz) / d < 0.3)) continue;
      if (!best || d < best.d) best = { id: t.id, x: t.x, z: t.z, d };
    }
    if (!best) {
      this.fx({ kind: "miss", x: from.x + fx, y: from.y + 1.3, z: from.z + fz });
      return;
    }
    const power = (itemId && content.items.get(itemId)?.chop) || UNARMED_CHOP;
    this.act(id, "chop");
    const result = this.play.chop(best.id, power);
    this.fx({ kind: "chop", x: best.x, y: from.y + 1.2, z: best.z, word: power >= 20 ? "CỐC!" : "CỘC", treeId: best.id });
    if (!result) return;
    const dir = Math.atan2(best.x - from.x, best.z - from.z);
    this.feat(id, "trees");
    this.fx({ kind: "fell", x: best.x, y: result.felled.y, z: best.z, dir, treeId: best.id, word: "RẮC RẮC... ẦM!" });
    // Gỗ, dừa, cây giống rơi dọc theo thân cây đổ.
    const reach = result.felled.height * 0.6;
    this.play.scatter(result.drops, best.x + Math.sin(dir) * reach, best.z + Math.cos(dir) * reach, 1.8);
    for (const rider of result.riders) this.fall(rider, result.felled.height, rider === id);
  }

  /** Đang leo mà cây bị đốn: rơi xuống, mất Máu theo độ cao, choáng váng một lúc. */
  private fall(playerId: string, height: number, self = false) {
    const h = this.host;
    this.feat(playerId, "falls");
    const p = h.state.players.get(playerId);
    if (!p) return;
    const ground = h.world().heightAt(p.x, p.z);
    const dropped = Math.max(1, p.y - ground);
    const damage = Math.min(FALL_DAMAGE_MAX, Math.round(Math.max(dropped, height * 0.5) * FALL_DAMAGE_PER_M));
    p.climbing = "";
    h.clientOf(playerId)?.send(Messages.correct, { x: p.x, y: ground, z: p.z } satisfies CorrectMessage);
    p.y = ground;
    this.play.applyStatus(playerId, { dizzy: 5, stun: 1 });
    h.encounter(playerId, "fall", "tree", "tree", { hp: -damage }, {}, {
      title: "Cây đổ!",
      text: self
        ? "Bạn vừa ôm cây vừa tự đốn chính cái cây đó. Cú ngã rất đẹp, rất đau, và rất đáng kể lại."
        : "Ai đó đốn đúng cái cây bạn đang ôm. Bạn rơi huỵch xuống đất, đầu óc quay cuồng.",
    });
    this.fx({ kind: "hit", x: p.x, y: ground + 1.5, z: p.z, word: "HUỴCH!", amount: damage });
  }

  private onThrow(client: Client, yaw: number, pitch: number, power: number) {
    const a = this.actor(client);
    if (!a) return;
    const held = this.heldItem(a.id);
    if (!held) return this.host.reject(client, "Tay không thì ném gì? Chọn một món trước (Q).");
    if (!this.play.ready(a.id, 0.6)) return;
    if (!this.host.dispatch({ type: "drop", playerId: a.id, uid: held.uid }, client)) return;
    this.play.held.delete(a.id);
    const stats = content.items.get(held.itemId)?.throw ?? { damage: 2, word: "BỐP!" };
    this.feat(a.id, "throws");
    this.play.throw(a.id, held.itemId, { x: a.player.x, y: a.player.y, z: a.player.z }, yaw, pitch, power, stats);
    this.act(a.id, "throw");
  }

  /** Trao món đang cầm cho người đứng sát bên. */
  private onGive(client: Client, targetId: string) {
    const a = this.actor(client, { allowTied: true });
    if (!a) return;
    const h = this.host;
    const held = this.heldItem(a.id);
    if (!held) return h.reject(client, "Cầm món muốn đưa trên tay trước (Q).");
    const target = h.state.players.get(targetId);
    if (!target || !h.game().players[targetId]?.alive) return h.reject(client, "Người này không nhận được.");
    if (Math.hypot(target.x - a.player.x, target.z - a.player.z) > GIVE_RADIUS + TOLERANCE) return h.reject(client, "Lại gần hơn mới đưa được.");
    if (!h.dispatch({ type: "give", playerId: a.id, target: targetId, uid: held.uid }, client)) return;
    this.play.held.delete(a.id);
    this.act(a.id, "throw");
    const name = content.items.get(held.itemId)?.name ?? held.itemId;
    h.clientOf(targetId)?.send(Messages.encounter, {
      title: `${a.player.name} đưa cho bạn ${name.toLowerCase()}`,
      text: "Món đồ đã nằm gọn trong balo của bạn.",
      tone: "good",
      effects: {},
      gained: held.itemId,
    } satisfies EncounterMessage);
    this.fx({ kind: "give", x: target.x, y: target.y + 1.6, z: target.z, word: "CẦM LẤY!" });
  }

  private onDrop(client: Client) {
    const a = this.actor(client, { allowTied: true, allowStun: true });
    if (!a) return;
    const held = this.heldItem(a.id);
    if (!held) return;
    if (!this.host.dispatch({ type: "drop", playerId: a.id, uid: held.uid }, client)) return;
    this.play.held.delete(a.id);
    const yaw = a.player.rotY;
    this.play.place(held.itemId, a.player.x + Math.sin(yaw) * 0.9, a.player.z + Math.cos(yaw) * 0.9, a.player.y);
  }

  private onPickup(client: Client, groundId: string) {
    const a = this.actor(client, { allowTied: true });
    if (!a) return;
    const item = this.play.ground.get(groundId);
    if (!item) return;
    if (Math.hypot(item.x - a.player.x, item.z - a.player.z) > PICKUP_RADIUS + TOLERANCE || Math.abs(item.y - a.player.y) > 3) {
      return this.host.reject(client, "Hãy lại gần hơn.");
    }
    if (!this.host.dispatch({ type: "pickup", playerId: a.id, itemId: item.itemId }, client)) return;
    this.play.ground.delete(groundId);
    // Nhặt bộ lửa trại dưới đất cũng tức là đang vác trại đi.
  }

  // ------------------------------------------------------------------ dùng đồ: ăn, trồng cây, đặt lửa trại

  /** Đứng ở lửa trại với món đang cầm: nướng (thịt, cá sống) hoặc góp vào kho lương thực chung. */
  private onCampfire(client: Client) {
    const a = this.actor(client, { allowTied: true });
    if (!a) return;
    const h = this.host;
    const camp = this.play.camp;
    if (camp.packed || Math.hypot(a.player.x - camp.x, a.player.z - camp.z) > CAMPFIRE_REACH + TOLERANCE) {
      return h.reject(client, "Phải đứng cạnh lửa trại.");
    }
    const held = this.heldItem(a.id);
    const def = held && content.items.get(held.itemId);
    if (!held || !def) return h.reject(client, "Cầm món muốn nướng hay góp vào kho trên tay trước (Q).");
    const at = { x: camp.x, y: h.world().heightAt(camp.x, camp.z) + 1.4, z: camp.z };
    if (def.cook) {
      if (!h.dispatch({ type: "cook", playerId: a.id, uid: held.uid }, client)) return;
      this.feat(a.id, "cooked");
      this.act(a.id, "chop");
      this.fx({ kind: "cook", ...at, word: "XÈO XÈO!" });
      return;
    }
    if (def.hull) {
      if (!h.dispatch({ type: "repair", playerId: a.id, uid: held.uid }, client)) return;
      this.play.held.delete(a.id);
      this.feat(a.id, "repaired", def.hull);
      this.act(a.id, "chop");
      this.fx({ kind: "repair", ...at, word: `+${def.hull} THÂN THUYỀN` });
      return;
    }
    if (def.ration) {
      if (!h.dispatch({ type: "stash", playerId: a.id, uid: held.uid }, client)) return;
      this.play.held.delete(a.id);
      this.feat(a.id, "stashed", def.ration);
      this.fx({ kind: "eat", ...at, word: `+${def.ration} KHẨU PHẦN` });
      return;
    }
    h.reject(client, "Món này không nướng hay góp vào kho được.");
  }

  /** Chế tạo từ đồ trong balo; công thức cần lửa thì phải đứng cạnh lửa trại (hay đang ngồi quanh lửa ban đêm). */
  private onCraft(client: Client, itemId: string) {
    const a = this.actor(client, { allowTied: true });
    if (!a) return;
    const h = this.host;
    const def = content.items.get(itemId);
    if (!def?.craft) return h.reject(client, "Món này không chế tạo được.");
    const camp = this.play.camp;
    const atFire =
      (!camp.packed && Math.hypot(a.player.x - camp.x, a.player.z - camp.z) <= CAMPFIRE_REACH + TOLERANCE) ||
      (h.state.phase === "night" && [...h.state.campers].includes(a.id));
    if (def.craft.fire && !atFire) return h.reject(client, `${def.name} phải làm cạnh lửa trại.`);
    if (!h.dispatch({ type: "craft", playerId: a.id, itemId, atFire }, client)) return;
    this.feat(a.id, "crafted");
    this.act(a.id, "chop");
    this.fx({ kind: "craft", x: a.player.x, y: a.player.y + 1.6, z: a.player.z, word: `${def.name.toUpperCase()}!` });
  }

  private onUse(client: Client, x: number, z: number) {
    const a = this.actor(client, { allowTied: true });
    if (!a) return;
    const held = this.heldItem(a.id);
    const def = held && content.items.get(held.itemId);
    if (!held || !def) return;
    const h = this.host;
    const near = Math.hypot(x - a.player.x, z - a.player.z) <= 4;
    if (def.eat) {
      if (!h.dispatch({ type: "consume", playerId: a.id, uid: held.uid }, client)) return;
      this.play.held.delete(a.id);
      if (def.eat.dizzy) this.play.applyStatus(a.id, { dizzy: def.eat.dizzy });
      this.act(a.id, "eat");
      this.fx({ kind: "eat", x: a.player.x, y: a.player.y + 1.7, z: a.player.z, word: def.eat.dizzy ? "ỰC... HỨC!" : "NHỒM NHOÀM" });
      return;
    }
    if (def.plant) {
      if (!near || a.sheet.tied) return h.reject(client, "Chỉ trồng được ngay trước mặt.");
      if (!this.play.canPlant(x, z)) return h.reject(client, "Không trồng được ở đây (đất cát ướt, đá, hay sát cây khác).");
      if (!h.dispatch({ type: "drop", playerId: a.id, uid: held.uid }, client)) return;
      this.play.held.delete(a.id);
      this.play.plant(def.plant, x, z);
      this.feat(a.id, "planted");
      this.act(a.id, "chop");
      this.fx({ kind: "plant", x, y: h.world().heightAt(x, z) + 0.5, z, word: "TRỒNG!" });
      return;
    }
    if (def.camp) {
      if (!near || a.sheet.tied) return h.reject(client, "Chỉ đặt lửa trại được ngay trước mặt.");
      if (!this.play.canCamp(x, z)) return h.reject(client, "Chỗ này không dựng trại được: cần đất khô và bằng phẳng.");
      if (!h.dispatch({ type: "drop", playerId: a.id, uid: held.uid }, client)) return;
      this.play.held.delete(a.id);
      this.moveCamp(x, z);
      this.fx({ kind: "build", x, y: h.world().heightAt(x, z) + 1, z, word: "DỰNG TRẠI!" });
      return;
    }
    h.reject(client, "Món này không dùng trực tiếp được. Chuột trái để đánh, chuột phải để ném.");
  }

  private moveCamp(x: number, z: number) {
    this.play.camp = { x, z, packed: false };
    // Cây mọc ngay giữa trại mới thì bị dọn đi (khỏi mắc kẹt trong lều).
    for (const t of this.play.standingTrees()) {
      if (Math.hypot(t.x - x, t.z - z) < 3.5) {
        if (this.play.planted.has(t.id)) this.play.planted.delete(t.id);
        else this.play.felled.add(t.id);
      }
    }
  }

  /** Nhổ trại: đứng cạnh lửa trại, nhấn E, được bộ lửa trại mang theo. Nhà cửa dời theo khi dựng lại. */
  private onPackCamp(client: Client) {
    const a = this.actor(client);
    if (!a) return;
    const h = this.host;
    if (this.play.camp.packed) return;
    if (h.game().phase === "dusk") return h.reject(client, "Trời sắp tối rồi, không nhổ trại được nữa.");
    if (Math.hypot(a.player.x - this.play.camp.x, a.player.z - this.play.camp.z) > 4) return h.reject(client, "Hãy đứng cạnh đống lửa.");
    if (!h.dispatch({ type: "pickup", playerId: a.id, itemId: "camp_kit" }, client)) return;
    this.play.camp.packed = true;
    this.fx({ kind: "build", x: this.play.camp.x, y: a.player.y + 1, z: this.play.camp.z, word: "NHỔ TRẠI!" });
  }

  /**
   * Trước khi tính ai về kịp trại lúc trời tối: trại đang bị nhổ thì dựng lại ngay chỗ bộ lửa trại đang ở
   * (trong balo ai thì chỗ người đó đứng, nằm dưới đất thì chỗ đó), không thấy đâu thì về chỗ cũ ban đầu.
   */
  ensureCamp() {
    if (!this.play.camp.packed) return;
    const h = this.host;
    for (const [id, sheet] of Object.entries(h.game().players)) {
      const kit = sheet.bag.find((b) => b.itemId === "camp_kit");
      const p = h.state.players.get(id);
      if (!kit || !p) continue;
      if (!h.dispatch({ type: "drop", playerId: id, uid: kit.uid })) continue;
      const spot = this.play.canCamp(p.x, p.z) ? { x: p.x, z: p.z } : { x: CAMP.x, z: CAMP.z };
      this.moveCamp(spot.x, spot.z);
      return;
    }
    for (const [gid, g] of this.play.ground) {
      if (g.itemId !== "camp_kit") continue;
      this.play.ground.delete(gid);
      this.moveCamp(this.play.canCamp(g.x, g.z) ? g.x : CAMP.x, this.play.canCamp(g.x, g.z) ? g.z : CAMP.z);
      return;
    }
    this.moveCamp(CAMP.x, CAMP.z);
  }

  private onBuild(client: Client, kind: string, x: number, z: number, rot: number, level: number) {
    const a = this.actor(client);
    if (!a) return;
    const h = this.host;
    const def = worldCatalog.buildings.get(kind);
    if (!def) return;
    if (def.snap) return this.onSnapBuild(client, a, def, x, z, rot, level);
    const camp = this.play.camp;
    if (camp.packed) return h.reject(client, "Phải dựng lửa trại trước đã.");
    const fromCamp = Math.hypot(x - camp.x, z - camp.z);
    if (fromCamp > BUILD_RADIUS) return h.reject(client, `Chỉ dựng được trong vòng ${BUILD_RADIUS} m quanh lửa trại.`);
    if (fromCamp < 3.5) return h.reject(client, "Sát đống lửa quá, cháy nhà mất.");
    if (Math.hypot(x - a.player.x, z - a.player.z) > 7) return h.reject(client, "Hãy lại gần chỗ định dựng.");
    const ground = h.world().heightAt(x, z);
    if (ground < 0.4 || h.world().structureAt(x, z)) return h.reject(client, "Không dựng được ở đây.");
    if (this.play.buildingAt(x, z, def.size[0] / 2 - 1.5)) return h.reject(client, "Chật quá, đè lên nhà khác.");
    if (this.play.standingTrees().some((t) => Math.hypot(t.x - x, t.z - z) < def.size[0] / 2 + 0.3)) return h.reject(client, "Vướng cây. Chặt đi đã.");
    if (!hasMaterials(a.sheet, def.cost)) {
      const need = Object.entries(def.cost)
        .map(([item, n]) => `${n} ${content.items.get(item)?.name.toLowerCase() ?? item}`)
        .join(", ");
      return h.reject(client, `Cần ${need} trong balo.`);
    }
    if (!h.dispatch({ type: "build", playerId: a.id, building: kind, cost: def.cost, shelter: def.shelter }, client)) return;
    this.feat(a.id, "built");
    this.play.buildings.set(this.play.id("h"), { kind, dx: x - camp.x, dz: z - camp.z, rot });
    this.act(a.id, "chop");
    this.fx({ kind: "build", x, y: ground + 1.5, z, word: "CỘC CỘC CỘC!" });
  }

  // ------------------------------------------------------------------ leo cây

  /** Mảnh lắp ghép của trại hiện có (sàn, vách, cầu thang, tháp canh). */
  snapPieces(): SnapPiece[] {
    const out: SnapPiece[] = [];
    for (const b of this.play.buildings.values()) {
      const snap = worldCatalog.buildings.get(b.kind)?.snap;
      if (snap) out.push(snapFromRecord(snap, b.dx, b.dz, b.rot, b.level ?? 0));
    }
    return out;
  }

  /**
   * Dựng một mảnh lắp ghép: bắt điểm ngắm vào lưới quanh lửa trại, kiểm tra chỗ đặt (đỡ, chồng lấn, địa hình, cây,
   * nhà kiểu cũ, nước lúc triều lên) bằng đúng hàm client dùng để vẽ bóng xanh đỏ, rồi trừ vật liệu.
   */
  private onSnapBuild(client: Client, a: { id: string; player: { x: number; y: number; z: number }; sheet: Parameters<typeof hasMaterials>[0] }, def: BuildingDef, x: number, z: number, rot: number, level: number) {
    const h = this.host;
    const camp = this.play.camp;
    if (camp.packed) return h.reject(client, "Phải dựng lửa trại trước đã.");
    if (Math.hypot(x - a.player.x, z - a.player.z) > 9) return h.reject(client, "Hãy lại gần chỗ định dựng.");
    const piece = snapPiece(def.snap!, x - camp.x, z - camp.z, level, rot);
    const obstacles = [
      ...this.play.standingTrees().map((t) => ({ x: t.x, z: t.z, r: 0.3 })),
      ...[...this.play.buildings.values()]
        .filter((b) => !worldCatalog.buildings.get(b.kind)?.snap)
        .map((b) => ({ x: camp.x + b.dx, z: camp.z + b.dz, r: (worldCatalog.buildings.get(b.kind)?.size[0] ?? 3) / 2 })),
    ];
    const terrain = snapTerrain(h.world(), camp.x, camp.z, obstacles, TIDE_MEAN + 0.3);
    const problem = snapProblem(this.snapPieces(), piece, terrain, snapReach(BUILD_RADIUS));
    if (problem) return h.reject(client, problem);
    if (!hasMaterials(a.sheet, def.cost)) {
      const need = Object.entries(def.cost)
        .map(([item, n]) => `${n} ${content.items.get(item)?.name.toLowerCase() ?? item}`)
        .join(", ");
      return h.reject(client, `Cần ${need} trong balo.`);
    }
    if (!h.dispatch({ type: "build", playerId: a.id, building: def.id, cost: def.cost, shelter: def.shelter }, client)) return;
    this.feat(a.id, "built");
    const o = snapOffset(piece);
    this.play.buildings.set(this.play.id("h"), { kind: def.id, dx: o.dx, dz: o.dz, rot: o.rot, level: piece.level });
    this.act(a.id, "chop");
    const base = terrain.cell(piece.i, piece.j).base;
    this.fx({ kind: "build", x: camp.x + o.dx, y: snapY(base, piece.level) + 1.5, z: camp.z + o.dz, word: "CỘC CỘC CỘC!" });
  }

  private onClimb(client: Client, treeId: string) {
    const h = this.host;
    const id = h.playerOf(client);
    if (!id) return;
    if (!treeId) {
      this.play.climbers.delete(id);
      return;
    }
    const a = this.actor(client);
    if (!a) return;
    const tree = this.play.tree(treeId);
    if (!tree) return h.reject(client, "Cây này không còn nữa.");
    if (!this.play.climbable(tree)) return h.reject(client, "Cây còn non quá, leo gãy mất.");
    if (Math.hypot(tree.x - a.player.x, tree.z - a.player.z) > CLIMB_REACH + TOLERANCE) return h.reject(client, "Hãy lại sát gốc cây.");
    if (a.player.y < this.play.seaLevel - 0.5) return h.reject(client, "Đang bơi thì leo sao được.");
    if (this.play.climbers.get(id) !== treeId) this.feat(id, "climbs");
    this.play.climbers.set(id, treeId);
  }

  /** Vị trí người leo cây phải bám quanh thân cây; lệch xa quá (tụt, nhảy xuống) thì thôi leo. */
  checkClimber(playerId: string, x: number, z: number) {
    const treeId = this.play.climbers.get(playerId);
    if (!treeId) return;
    const t = this.play.tree(treeId);
    if (!t || Math.hypot(t.x - x, t.z - z) > 2.5) this.play.climbers.delete(playerId);
  }

  // ------------------------------------------------------------------ kết liễu

  private onAssassinate(client: Client, target: string) {
    const a = this.actor(client);
    if (!a) return;
    const h = this.host;
    if (!canAssassinate(h.game(), a.id)) return h.reject(client, "Bạn không ra tay được lúc này.");
    const victim = h.state.players.get(target);
    if (!victim || !h.game().players[target]?.alive) return;
    if (Math.hypot(victim.x - a.player.x, victim.z - a.player.z) > ASSASSINATE_RADIUS + TOLERANCE || Math.abs(victim.y - a.player.y) > 2) {
      return h.reject(client, "Phải đứng sát sau lưng người đó.");
    }
    if (!h.dispatch({ type: "assassinate", playerId: a.id, target }, client)) return;
    this.act(a.id, "stab");
    this.play.applyStatus(target, { stun: 2 });
    const d = Math.hypot(victim.x - a.player.x, victim.z - a.player.z) || 1;
    h.clientOf(target)?.send(Messages.knock, { dx: (victim.x - a.player.x) / d, dz: (victim.z - a.player.z) / d, force: 6 } satisfies KnockMessage);
    // Hiệu ứng không kèm tên người ra tay: ai đứng gần mới thấy tận mắt.
    this.fx({ kind: "kill", x: victim.x, y: victim.y + 1.6, z: victim.z, word: "RẮC!" });
  }

  // ------------------------------------------------------------------ nhịp thời gian thực

  tick(dt: number, active: boolean) {
    const h = this.host;
    this.play.tick(dt);
    // Người mất món đang cầm (ăn hết, bị lấy trộm, rơi mất) thì về tay không.
    for (const [id, uid] of this.play.held) {
      if (!h.game().players[id]?.bag.some((b) => b.uid === uid)) this.play.held.delete(id);
    }
    const events = this.play.stepProjectiles(dt, this.targets(""));
    for (const e of events) {
      const p = e.projectile;
      if (e.kind === "hit") {
        this.hit(p.owner, e.target, p.hit, p.itemId, { x: p.x - p.vx * 0.1, z: p.z - p.vz * 0.1 });
        if (!p.hit.breaks) this.play.place(p.itemId, e.target.x, e.target.z);
      } else {
        if (e.water) this.fx({ kind: "splash", x: e.x, y: this.play.seaLevel, z: e.z });
        if (p.hit.breaks) this.fx({ kind: "hit", x: e.x, y: Math.max(e.y, this.play.seaLevel) + 0.4, z: e.z, word: p.hit.word ?? "BỐP!" });
        else this.play.place(p.itemId, e.x, e.z);
      }
    }
    if (active) this.spawnSharks(dt);
    this.sync();
  }

  /** Ai bơi ngoài khơi (nước sâu, xa bờ) một lúc thì cá mập tìm tới. */
  private spawnSharks(dt: number) {
    const h = this.host;
    const world = h.world();
    for (const [id, p] of h.state.players) {
      const offshore = p.y < this.play.seaLevel - 0.5 && world.heightAt(p.x, p.z) < -6 && world.surface(p.x, p.z).inland < -18;
      if (!offshore || !h.game().players[id]?.alive) {
        this.seaTime.set(id, 0);
        continue;
      }
      const t = (this.seaTime.get(id) ?? 0) + dt;
      this.seaTime.set(id, t);
      if (t > SHARK_AFTER && this.play.rand() < SHARK_CHANCE_PER_SECOND * dt) {
        const shark = h.wildlife().spawnShark(p);
        if (shark) {
          this.seaTime.set(id, -20);
          this.fx({ kind: "splash", x: shark.x, y: this.play.seaLevel, z: shark.z, word: "VÂY CÁ MẬP!" });
        }
      }
    }
  }

  /** Chép phần công khai sang state (chỉ gán khi đổi, để Colyseus không gửi thừa). */
  sync() {
    const s = this.host.state;
    const game = this.host.game();
    const round = (v: number) => Math.round(v * 10) / 10;
    for (const [id, p] of s.players) {
      const held = this.heldItem(id)?.itemId ?? "";
      if (p.held !== held) p.held = held;
      const st = this.play.status.get(id);
      const stun = round(st?.stun ?? 0);
      const dizzy = round(st?.dizzy ?? 0);
      const blind = round(st?.blind ?? 0);
      if (p.stun !== stun) p.stun = stun;
      if (p.dizzy !== dizzy) p.dizzy = dizzy;
      if (p.blind !== blind) p.blind = blind;
      const climbing = game.players[id]?.alive ? (this.play.climbers.get(id) ?? "") : "";
      if (p.climbing !== climbing) p.climbing = climbing;
    }
    syncMap(s.groundItems, this.play.ground, () => new GroundItemState(), (t, g) => {
      t.itemId = g.itemId;
      t.x = g.x;
      t.y = g.y;
      t.z = g.z;
    });
    syncMap(s.projectiles, this.play.projectiles, () => new ProjectileState(), (t, p) => {
      t.itemId = p.itemId;
      t.x = p.x;
      t.y = p.y;
      t.z = p.z;
    }, true);
    syncMap(s.plants, this.play.planted, () => new PlantState(), (t, p) => {
      t.kind = p.kind;
      t.x = p.x;
      t.y = p.y;
      t.z = p.z;
      const g = Math.round(p.growth * 50) / 50;
      if (t.growth !== g) t.growth = g;
    }, true);
    syncMap(s.buildings, this.play.buildings, () => new BuildingState(), (t, b) => {
      t.kind = b.kind;
      t.dx = b.dx;
      t.dz = b.dz;
      t.rot = b.rot;
      t.level = b.level ?? 0;
    });
    const stumps = [...this.play.felled].join(",");
    if (stumps !== this.synced.stumps) {
      this.synced.stumps = stumps;
      s.stumps.clear();
      s.stumps.push(...this.play.felled);
    }
    const camp = this.play.camp;
    if (s.campX !== camp.x) s.campX = camp.x;
    if (s.campZ !== camp.z) s.campZ = camp.z;
    if (s.campPacked !== camp.packed) s.campPacked = camp.packed;
  }
}

/** Đồng bộ một Map thường sang MapSchema: thêm, bớt, và (nếu `update`) chép lại giá trị mỗi lần. */
function syncMap<V, T>(
  target: { keys(): IterableIterator<string>; get(k: string): T | undefined; set(k: string, v: T): unknown; delete(k: string): unknown },
  source: ReadonlyMap<string, V>,
  create: () => T,
  fill: (t: T, v: V) => void,
  update = false,
) {
  for (const key of [...target.keys()]) if (!source.has(key)) target.delete(key);
  for (const [key, value] of source) {
    let t = target.get(key);
    if (!t) {
      t = create();
      fill(t, value);
      target.set(key, t);
    } else if (update) fill(t, value);
  }
}
