import { MAX_HP, SMOKE_CLEAR, START_MONEY, WEAPON, insideBox, raycastBoxes, raycastTerrain } from "@tentides/content";
import type { BattleRoom } from "./BattleRoom.ts";
import { addAmmo, isGunSlot, magOf, receive, resetKit, weaponIn } from "./kit.ts";

// Máy (bot) cho Battleground: đi lang thang trong vùng an toàn, tránh tường và nước, thấy ai trong tầm nhìn
// (không bị tường, đồi che) thì quay lại bắn từng loạt, trúng hay trật tuỳ khoảng cách; bị bắn thì quay sang
// kẻ bắn mình. Bắn qua đúng hàm `fire` của người chơi nên cũng bị kiểm tra đạn, tốc độ bắn, tường chắn như ai.

const NAMES = ["Hải Âu", "Cá Mập", "Kền Kền", "Rắn Hổ", "Bão Cát", "Sói Xám", "Đại Bàng", "Chim Cắt", "Báo Đốm", "Gấu Nâu", "Cú Mèo", "Mãng Xà"];
const LOADOUTS = ["m416", "akm", "scar", "ump45", "vector", "sks", "s686", "m416", "akm"];
const SIGHT = 70;

interface Brain {
  wx: number;
  wz: number;
  target: string;
  seen: number;
  react: number;
  burst: number;
  pause: number;
  scan: number;
  strafe: number;
}

export class Bots {
  private brains = new Map<string, Brain>();

  constructor(private readonly room: BattleRoom) {}

  /** Thêm hoặc bớt máy cho đủ `n`. */
  sync(n: number) {
    const s = this.room.state;
    const ids = [...s.players.entries()].filter(([, p]) => p.bot).map(([id]) => id);
    for (const id of ids.slice(n)) {
      s.players.delete(id);
      this.brains.delete(id);
    }
    for (let k = ids.length; k < n; k++) {
      const id = `bot${k + 1}`;
      const p = this.room.newPlayer();
      p.name = `🤖 ${NAMES[k % NAMES.length]}`;
      p.bot = true;
      p.connected = true;
      p.color = this.room.pickColor();
      p.kit.outfit = ["woodland", "desert", "urban", "digital", "ghillie"][k % 5]!;
      s.players.set(id, p);
      this.room.randomSpawn(p);
    }
  }

  /** Mỗi máy một bộ đồ ngẫu nhiên: một khẩu chính, đạn, giáp và mũ cấp 1–2, băng gạc. */
  equipAll() {
    for (const [id, p] of this.room.state.players) {
      if (!p.bot) continue;
      const outfit = p.kit.outfit;
      resetKit(p.kit, START_MONEY);
      p.kit.outfit = outfit;
      const gun = LOADOUTS[Math.floor(Math.random() * LOADOUTS.length)]!;
      const def = WEAPON.get(gun)!;
      receive(p.kit, gun, []);
      addAmmo(p.kit, def.ammo, def.mag * 3);
      receive(p.kit, `armor:${1 + Math.floor(Math.random() * 2)}`, []);
      receive(p.kit, `helmet:${1 + Math.floor(Math.random() * 2)}`, []);
      receive(p.kit, "bandage", []);
      p.hp = MAX_HP;
      this.brains.set(id, this.fresh(p.x, p.z));
    }
  }

  onHurt(target: string, attacker: string) {
    const b = this.brains.get(target);
    if (b && attacker && attacker !== target) {
      if (b.target !== attacker) b.react = 0.35 + Math.random() * 0.3;
      b.target = attacker;
      b.seen = 3;
    }
  }

  private fresh(x: number, z: number): Brain {
    return { wx: x, wz: z, target: "", seen: 0, react: 0, burst: 0, pause: 0, scan: Math.random() * 0.5, strafe: 0 };
  }

  tick(dt: number) {
    const room = this.room;
    const s = room.state;
    if (!room.fighting()) return;
    for (const [id, p] of s.players) {
      if (!p.bot || !p.alive) continue;
      let b = this.brains.get(id);
      if (!b) {
        b = this.fresh(p.x, p.z);
        this.brains.set(id, b);
      }
      const eye: [number, number, number] = [p.x, p.y + 1.55, p.z];

      // Tìm mục tiêu mỗi nửa giây.
      b.scan -= dt;
      if (b.scan <= 0) {
        b.scan = 0.5;
        let best = "";
        let bestD = SIGHT;
        for (const [oid, o] of s.players) {
          if (oid === id || !o.alive) continue;
          const d = Math.hypot(o.x - p.x, o.z - p.z);
          if (d > bestD || !this.visible(eye, o.x, o.y + (o.crouching ? 0.8 : 1.2), o.z)) continue;
          best = oid;
          bestD = d;
        }
        if (best) {
          if (best !== b.target) b.react = 0.8 + Math.random() * 0.7;
          b.target = best;
          b.seen = 2.5;
        } else b.seen -= 0.5;
        if (b.seen <= 0) b.target = "";
      }

      const target = b.target ? s.players.get(b.target) : undefined;
      const kit = p.kit;
      if (!isGunSlot(kit.active) && kit.primary1) kit.active = "primary1";
      const slot = isGunSlot(kit.active) ? kit.active : null;
      const def = slot ? weaponIn(kit, slot) : undefined;
      if (slot && def && magOf(kit, slot) === 0 && !kit.reloading) room.reload(id);

      let mx = 0;
      let mz = 0;
      let speed = 5;
      if (target && target.alive && s.phase === "battle") {
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        p.rotY = Math.atan2(dx, dz);
        p.aimPitch = Math.atan2(target.y + 1.1 - eye[1], d);
        p.aiming = d > 25;
        // Né qua lại trong lúc bắn.
        b.strafe -= dt;
        if (b.strafe < -1.2) b.strafe = 1.2 * Math.random() + 0.3;
        const side = b.strafe > 0 ? 1 : -1;
        mx = (-dz / d) * side * 0.6;
        mz = (dx / d) * side * 0.6;
        speed = 3;
        if (b.react > 0) b.react -= dt;
        else if (def && slot && !kit.reloading) this.shoot(id, b, dt, def.id, eye, target, d);
      } else {
        p.aiming = false;
        // Đi về điểm đích trong vùng an toàn; tới nơi hoặc vùng đổi thì chọn điểm mới.
        const z = s.zone;
        const inNext = Math.hypot(b.wx - z.nx, b.wz - z.nz) < Math.max(8, z.nr * 0.8);
        if (Math.hypot(b.wx - p.x, b.wz - p.z) < 3 || (s.phase === "battle" && !inNext)) this.pickWaypoint(b);
        const dx = b.wx - p.x;
        const dz = b.wz - p.z;
        const d = Math.hypot(dx, dz) || 1;
        mx = dx / d;
        mz = dz / d;
        const outside = Math.hypot(p.x - z.x, p.z - z.z) > z.r - 5;
        speed = outside ? 7.5 : 5;
        p.rotY = Math.atan2(mx, mz);
        p.aimPitch = 0;
      }

      // Bước tới: tránh tường, tránh nước sâu; kẹt thì đổi hướng.
      if (mx || mz) {
        const nx = p.x + mx * speed * dt;
        const nz = p.z + mz * speed * dt;
        const ny = room.map.world.heightAt(nx, nz);
        const blocked = ny < 0.3 || ny - p.y > 0.8 || insideBox(room.map.index, nx, ny + 0.9, nz, 0.35);
        if (blocked) this.pickWaypoint(b);
        else {
          p.x = nx;
          p.z = nz;
          p.y = ny;
          p.moving = true;
        }
      } else p.moving = false;
      // Máu thấp mà không ai bắn thì băng bó.
      if (!target && p.hp < 60 && kit.bandage > 0 && !kit.healing) this.heal(id);
    }
  }

  private heal(id: string) {
    const p = this.room.state.players.get(id)!;
    p.kit.bandage -= 1;
    p.hp = Math.min(75, p.hp + 15);
  }

  private visible(eye: [number, number, number], x: number, y: number, z: number): boolean {
    const dx = x - eye[0];
    const dy = y - eye[1];
    const dz = z - eye[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const dir: [number, number, number] = [dx / d, dy / d, dz / d];
    // Khói che tầm nhìn.
    for (const smoke of this.room.state.smokes.values()) {
      const t = (smoke.x - eye[0]) * dir[0] + (smoke.y + 1.5 - eye[1]) * dir[1] + (smoke.z - eye[2]) * dir[2];
      if (t < 0 || t > d) continue;
      const px = eye[0] + dir[0] * t - smoke.x;
      const py = eye[1] + dir[1] * t - smoke.y - 1.5;
      const pz = eye[2] + dir[2] * t - smoke.z;
      // Lựu đạn vừa thổi thủng một khoảng trong khói thì nhìn xuyên qua được chỗ đó.
      if (smoke.clear > 0 && Math.hypot(px + smoke.x - smoke.cx, pz + smoke.z - smoke.cz) < SMOKE_CLEAR.radius) continue;
      if (Math.hypot(px, py, pz) < 6) return false;
    }
    return raycastBoxes(this.room.map.index, eye, dir, d - 0.5) === Infinity && raycastTerrain(this.room.map.world, eye, dir, d - 0.5) === Infinity;
  }

  private shoot(id: string, b: Brain, dt: number, weaponId: string, eye: [number, number, number], target: { x: number; y: number; z: number; crouching: boolean; moving: boolean }, d: number) {
    // Bị bom choáng loá mắt thì không bắn được.
    if ((this.room.state.players.get(id)?.blind ?? 0) > 0) return;
    const def = WEAPON.get(weaponId)!;
    if (b.pause > 0) {
      b.pause -= dt;
      return;
    }
    if (b.burst <= 0) b.burst = def.auto ? 3 + Math.floor(Math.random() * 5) : 1;
    let targetId = "";
    for (const [tid, t] of this.room.state.players) if (t === target) targetId = tid;
    const aimY = target.y + (target.crouching ? 0.8 : 1.2);
    // Máy bắn kém dần theo khoảng cách, bắn liền nhiều phát thì kém đi (giật súng).
    let chance = Math.max(0.05, Math.min(0.42, 0.5 - d / 140));
    if (target.crouching) chance *= 0.8;
    if (target.moving) chance *= 0.8;
    const pellets = def.pellets;
    const rays: [number, number, number][] = [];
    const hits: { target: string; part: "head" | "body"; d: number; ray: number }[] = [];
    for (let k = 0; k < pellets; k++) {
      const hit = Math.random() < chance;
      const miss = hit ? 0.15 : 1.2 + Math.random() * 1.5;
      const a = Math.random() * Math.PI * 2;
      const tx = target.x + Math.cos(a) * miss * (hit ? 0.3 : 1);
      const ty = aimY + Math.sin(a) * miss * 0.6;
      const tz = target.z + Math.sin(a) * miss * (hit ? 0.3 : 1);
      rays.push([tx - eye[0], ty - eye[1], tz - eye[2]]);
      if (hit) hits.push({ target: targetId, part: Math.random() < 0.08 ? "head" : "body", d: Math.hypot(tx - eye[0], ty - eye[1], tz - eye[2]), ray: k });
    }
    // Đầu nòng ngay trước mặt.
    this.room.fire(id, weaponId, eye, rays, hits);
    b.burst -= 1;
    if (b.burst <= 0) b.pause = 0.35 + Math.random() * 0.6 + (def.auto ? 0 : 0.4);
    else b.pause = 60 / def.rpm;
  }

  private pickWaypoint(b: Brain) {
    const s = this.room.state;
    const z = s.zone;
    const map = this.room.map;
    const mf = map.sites.find((x) => x.kind === "minefield")!;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * Math.max(10, Math.min(z.nr || 150, 150) * 0.85);
      const x = (s.phase === "battle" ? z.nx : 0) + Math.cos(a) * r;
      const zz = (s.phase === "battle" ? z.nz : 0) + Math.sin(a) * r;
      if (map.world.heightAt(x, zz) < 0.8) continue;
      if (Math.hypot(x - mf.x, zz - mf.z) < Math.max(mf.rx, mf.rz) + 4) continue;
      b.wx = x;
      b.wz = zz;
      return;
    }
  }
}
