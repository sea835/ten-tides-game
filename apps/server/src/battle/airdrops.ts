import { AIRDROP, airdropAltitude, airdropLoot, airdropSpot, floorBelow, type BattleMap } from "@tentides/content";
import { AirdropState, type IslandState } from "@tentides/protocol";

// Thùng thính của phòng Battleground (sinh tồn, đồng đội; chiến trường thì không có): vào trận được một lúc thì
// máy bay thả thùng đầu tiên, sau đó cứ vài phút một thùng, tối đa vài thùng mỗi trận. Thùng rơi chậm bằng dù
// tới một chỗ trống trong vùng an toàn; chạm đất thì đồ xịn đổ ra quanh thùng thành đồ dưới đất (nhặt bằng E như
// mọi món khác) và khói đỏ bốc lên cho cả đảo thấy mà kéo tới tranh nhau.

/** Co giãn thời gian khi dev (giống phòng), vd. BATTLE_SCALE=0.3 thì thùng rơi sớm hơn. */
const SCALE = Number(process.env.BATTLE_SCALE ?? 1);
const sec = (s: number) => Math.max(1, s * SCALE);

/** Những gì thùng thính cần từ phòng: state, bản đồ, bộ số ngẫu nhiên của trận, cách đặt một món xuống đất. */
export interface AirdropHost {
  state: IslandState;
  map: BattleMap;
  random(): number;
  putItem(itemId: string, x: number, y: number, z: number): void;
}

export class Airdrops {
  /** Còn bao nhiêu giây tới lượt thả kế tiếp (chỉ đếm trong pha "battle"). */
  private next = sec(AIRDROP.first);
  /** Đã thả bao nhiêu thùng trong trận này. */
  count = 0;
  private seq = 0;
  /** Thùng chi viện đặc biệt (điểm chiến thuật, streaks.ts): đồ định sẵn thay cho đồ thùng thính thường. */
  private special = new Map<AirdropState, string[]>();

  constructor(private host: AirdropHost) {}

  /** Trận mới (hay về sảnh): dọn thùng cũ, đếm lại từ đầu. */
  clear() {
    this.host.state.airdrops.clear();
    this.special.clear();
    this.next = sec(AIRDROP.first);
    this.count = 0;
  }

  tick(dt: number) {
    const s = this.host.state;
    if (s.phase !== "battle") return;
    // Chiến trường không có thùng thính định kỳ, chỉ có thùng chi viện gọi bằng điểm chiến thuật.
    if (s.battleMode !== "war") this.next -= dt;
    if (this.next <= 0) {
      const [lo, hi] = AIRDROP.every;
      this.next = sec(lo + this.host.random() * (hi - lo));
      // Vùng đã co quá nhỏ (vòng cuối) thì thôi thả: vào đó là chết vì vùng độc.
      if (this.count < AIRDROP.max && s.zone.r > 25) this.drop();
    }
    for (const a of s.airdrops.values()) {
      if (!a.landed) {
        a.fallLeft = Math.max(0, a.fallLeft - dt);
        a.y = a.ground + airdropAltitude(1 - a.fallLeft / sec(AIRDROP.fall));
        if (a.fallLeft <= 0) this.land(a);
      } else if (a.smoke > 0) a.smoke = Math.max(0, a.smoke - dt);
    }
  }

  /** Thả một thùng: chọn chỗ trống trong vùng an toàn (ưu tiên vòng kế tiếp nếu đã định, để thùng không nằm ngoài vùng khi chạm đất). */
  drop(): AirdropState | null {
    const s = this.host.state;
    const z = s.zone;
    const zone = z.nr > 0 ? { x: z.nx, z: z.nz, r: z.nr } : { x: z.x, z: z.z, r: z.r };
    const spot = airdropSpot(this.host.map, zone, () => this.host.random()) ?? airdropSpot(this.host.map, { x: z.x, z: z.z, r: z.r }, () => this.host.random());
    if (!spot) return null;
    const a = new AirdropState();
    a.x = spot.x;
    a.z = spot.z;
    a.ground = spot.y;
    a.y = spot.y + AIRDROP.height;
    a.fallLeft = sec(AIRDROP.fall);
    s.airdrops.set(`d${++this.seq}`, a);
    this.count += 1;
    return a;
  }

  /**
   * Thùng chi viện (điểm chiến thuật): thả dù xuống đúng chỗ (x, z), mặt đất `y` (đã kiểm tra trống), chứa đúng các
   * món `items`. Rơi nhanh hơn thùng thính thường (người gọi đang chờ).
   */
  dropAt(x: number, y: number, z: number, items: string[]): AirdropState | null {
    if (this.host.state.phase !== "battle" || !items.length) return null;
    const a = new AirdropState();
    a.x = x;
    a.z = z;
    a.ground = y;
    // Bung dù thấp hơn (đi tiếp đường rơi của thùng thường từ chỗ 40%), chạm đất sau 60% thời gian.
    a.fallLeft = sec(AIRDROP.fall * 0.6);
    a.y = y + airdropAltitude(1 - a.fallLeft / sec(AIRDROP.fall));
    this.special.set(a, items);
    this.host.state.airdrops.set(`d${++this.seq}`, a);
    return a;
  }

  /** Chạm đất: đổ đồ ra thành vòng quanh thùng (nhặt như đồ thường), bung khói đỏ. */
  private land(a: AirdropState) {
    a.landed = true;
    a.y = a.ground;
    a.fallLeft = 0;
    a.smoke = sec(AIRDROP.smoke);
    const preset = this.special.get(a);
    this.special.delete(a);
    const items = preset ?? airdropLoot(() => this.host.random());
    const map = this.host.map;
    items.forEach((itemId, i) => {
      const ang = (i / items.length) * Math.PI * 2 + this.host.random() * 0.2;
      const r = AIRDROP.ring + (i % 2) * 0.45;
      const x = a.x + Math.cos(ang) * r;
      const z = a.z + Math.sin(ang) * r;
      this.host.putItem(itemId, x, floorBelow(map, x, a.ground + 1.5, z), z);
    });
  }
}
