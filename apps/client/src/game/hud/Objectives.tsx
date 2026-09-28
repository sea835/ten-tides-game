import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Lightbulb, Navigation, X } from "lucide-react";
import { ANCHORS, TREASURE_SITES, content } from "@tentides/content";
import { DIG_ITEM, TREASURE_REVEAL, missingMaterials } from "@tentides/rules";
import { myId, type IslandRoom } from "../../net.ts";
import { useCameraView } from "../camera.ts";
import { guide, type GuideTarget } from "../guide.ts";
import { useHud } from "../hudStore.ts";
import { usePrivate } from "../privateStore.ts";
import { useRoomSnapshot } from "../useRoomSnapshot.ts";
import { useWorld } from "../world.ts";
import { useTouchDevice } from "./TouchControls.tsx";

// Người mới hay không biết làm gì: bảng "việc hôm nay" luôn nói rõ mục tiêu kế tiếp, mũi tên chỉ đường tới đó,
// và vài mẹo hiện đúng lúc (mỗi mẹo một lần) thay cho bảng phím tắt dài.

/** Còn chừng này giây thăm dò thì mũi tên quay về trại. */
const HEAD_HOME_AT = 45;

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function Goal({ done, urgent, children, hint }: { done?: boolean; urgent?: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <li className={`goal${done ? " done" : ""}${urgent ? " urgent" : ""}`}>
      {done ? <Check size={14} aria-hidden /> : <Circle size={12} aria-hidden />}
      <div>
        <span>{children}</span>
        {hint && !done && <small>{hint}</small>}
      </div>
    </li>
  );
}

/** Bảng việc cần làm trong ngày, và chọn đích cho mũi tên. */
export function Objectives({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const world = useWorld(room);
  const touch = useTouchDevice();
  const s = useRoomSnapshot(room, (st) => {
    const self = st.players.get(me);
    const alive = [...st.players.values()].filter((p) => p.alive).length;
    return {
      phase: st.phase,
      day: st.day,
      timeLeft: st.timeLeft,
      alive: self?.alive ?? false,
      lost: self?.lost ?? false,
      tied: self?.tied ?? false,
      hasShovel: [...(self?.items ?? [])].includes(DIG_ITEM),
      food: st.food,
      mouths: alive,
      treasure: st.treasure,
      site: st.treasureSite,
      dug: st.treasureDug,
      safe: st.treasureSafe,
      carrier: st.treasureCarrier,
      carrierName: st.players.get(st.treasureCarrier)?.name ?? "",
      camp: st.campPacked ? null : { x: st.campX, z: st.campZ },
      open: [...st.anchors.entries()].filter(([, a]) => a.status === "open").map(([id]) => id),
      pageFound: [...st.discovered].includes(`page${st.day}`),
    };
  });
  const active = (s.phase === "explore" || s.phase === "dusk") && s.alive;
  const goHome = s.phase === "dusk" || (s.phase === "explore" && s.timeLeft <= HEAD_HOME_AT);
  const carrying = s.carrier === me && !s.safe;
  const digHere = !!s.site && !s.dug && s.hasShovel;
  const hasPage = world.pages.some((p) => p.day === s.day);

  // Đích của mũi tên theo thứ tự ưu tiên: về trại lúc sắp tối hay đang vác rương, chỗ đào nếu có xẻng, rồi sự kiện gần nhất.
  useEffect(() => {
    const targets: GuideTarget[] = [];
    const camp = s.camp ? { x: s.camp.x, y: world.heightAt(s.camp.x, s.camp.z) + 1.5, z: s.camp.z, label: "Lửa trại", tone: "camp" as const } : null;
    if (!active) {
      // Không chơi (chết, ban đêm…): không chỉ đường.
    } else if ((goHome || carrying) && camp) targets.push(camp);
    else if (digHere) {
      const t = TREASURE_SITES.find((x) => x.id === s.site);
      if (t) targets.push({ x: t.x, y: t.y + 2, z: t.z, label: "Chỗ đào kho báu", tone: "treasure" });
    } else if (!s.lost && !s.tied) {
      for (const id of s.open) {
        const a = ANCHORS.find((x) => x.id === id);
        if (a) targets.push({ x: a.x, y: a.y + 2.5, z: a.z, label: "Sự kiện", tone: "event" });
      }
    }
    guide.targets = targets;
  }, [active, goHome, carrying, digHere, s.site, s.open.join(","), s.camp?.x, s.camp?.z, s.lost, s.tied, world]);
  useEffect(() => () => void (guide.targets = []), []);

  if (!active) return null;
  const use = touch ? "nút Dùng" : "E";
  const hit = touch ? "nút Đánh" : "chuột trái";
  const treasureGoal = s.safe ? (
    <Goal done>Kho báu đã về trại</Goal>
  ) : s.dug ? (
    <Goal urgent={carrying} hint={carrying ? "Theo mũi tên. Bị đánh là rơi rương!" : undefined}>
      {carrying ? "Vác rương về lửa trại!" : s.carrierName ? `${s.carrierName} đang vác rương về trại` : "Rương đang nằm ngoài kia"}
    </Goal>
  ) : s.site ? (
    <Goal hint={s.hasShovel ? `Theo mũi tên đỏ, tới nơi bấm ${use}` : "Ai có xẻng hãy tới cột sáng đỏ"}>Đào kho báu</Goal>
  ) : (
    <Goal hint="Chọn đúng ở sự kiện và tìm trang nhật ký để có thêm manh mối">
      Manh mối kho báu {s.treasure}/{TREASURE_REVEAL}
    </Goal>
  );

  return (
    <section className="panel objectives">
      <div className="objectives-title">
        <Navigation size={13} aria-hidden /> Việc hôm nay
      </div>
      <ul>
        {goHome && (
          <Goal urgent hint="Ai ở ngoài lúc trời tối phải ngủ ngoài, mất sức">
            Về lửa trại {s.phase === "dusk" ? `(còn ${s.timeLeft}s)` : `trước khi tối (${clock(s.timeLeft)})`}
          </Goal>
        )}
        <Goal
          done={s.open.length === 0}
          hint={s.lost ? "Bạn bị lạc: hôm nay không mở được sự kiện nữa" : `Theo mũi tên vàng, tới cột sáng bấm ${use}`}
        >
          {s.open.length ? `Mở sự kiện (còn ${s.open.length})` : "Đã mở hết sự kiện"}
        </Goal>
        <Goal done={s.food >= s.mouths} hint={`Dùng ${hit} chặt cây dừa, bắt cá, săn thú; mang về lửa trại bấm ${use} để góp`}>
          Lương thực cho đêm nay {s.food}/{s.mouths}
        </Goal>
        {hasPage && <Goal done={s.pageFound} hint="Tờ giấy phát sáng ở đâu đó trên đảo, có cả manh mối kho báu">Tìm trang nhật ký hôm nay</Goal>}
        {treasureGoal}
      </ul>
    </section>
  );
}

/** Góc nhìn thứ nhất: chấm ngắm giữa màn hình. */
export function Crosshair() {
  return useCameraView() === "first" ? <div className="crosshair" aria-hidden /> : null;
}

/** Mũi tên chỉ đường; vị trí do WaypointTracker (trong cảnh 3D) ghi mỗi khung hình. */
export function WaypointMarker() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    guide.el = ref.current;
    return () => void (guide.el = null);
  }, []);
  return (
    <div ref={ref} className="waypoint" style={{ display: "none" }}>
      <div className="wp-arrow" />
      <div className="wp-text">
        <span className="wp-label" />
        <span className="wp-dist" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- mẹo theo ngữ cảnh

const TIPS_KEY = "tentides.tips";
const CRAFTABLE = [...content.items.values()].filter((i) => i.craft);

interface Tip {
  id: string;
  text: (touch: boolean) => string;
}

const TIPS: Record<string, Tip> = {
  start: {
    id: "start",
    text: (t) =>
      t
        ? "Gạt cần bên trái để đi (đẩy hết cỡ là chạy), vuốt nửa phải màn hình để nhìn. Theo mũi tên vàng tới cột sáng để mở sự kiện."
        : "WASD để đi, Shift để chạy, bấm vào màn hình rồi rê chuột để nhìn. Theo mũi tên vàng tới cột sáng để mở sự kiện.",
  },
  anchor: {
    id: "anchor",
    text: (t) => `Bấm ${t ? "nút Dùng" : "E"} để mở sự kiện. Ai đứng gần cũng được tham gia và cùng chọn; chỉ số hợp với lựa chọn thì dễ thành công hơn.`,
  },
  tree: {
    id: "tree",
    text: (t) => `Cây! ${t ? "Nút Đánh" : "Chuột trái"} để chặt lấy gỗ, dừa (cầm rìu thì nhanh hơn). ${t ? "Nút Dùng" : "E"} để leo lên nhìn xa.`,
  },
  item: {
    id: "item",
    text: (t) => `Bấm ${t ? "nút Dùng" : "E"} để nhặt. ${t ? "Nút Đổi món" : "Q hoặc lăn chuột"} để chọn món cầm tay; cầm đồ ăn rồi ${t ? "bấm Đánh" : "bấm chuột trái"} là ăn.`,
  },
  campfire: {
    id: "campfire",
    text: (t) => `Lửa trại: cầm đồ ăn rồi bấm ${t ? "nút Dùng" : "E"} để góp vào kho chung hay nướng chín. Đêm nào kho cũng cần mỗi người một phần.`,
  },
  hungry: {
    id: "hungry",
    text: (t) => `Bạn đang đói. Cầm đồ ăn (dừa, cá, thịt…) rồi ${t ? "bấm nút Đánh" : "bấm chuột trái"} để ăn; đói lả thì mất máu.`,
  },
  swim: {
    id: "swim",
    text: (t) => `Đang bơi: ${t ? "giữ nút Ngoi" : "giữ Space"} để nổi. Hết hơi, kiệt sức hay mang đồ nặng sẽ chìm và mất máu. Coi chừng cá mập ngoài khơi.`,
  },
  dusk: {
    id: "dusk",
    text: () => "Trời sắp tối! Chạy theo mũi tên cam về lửa trại. Ai ở ngoài phải ngủ ngoài: mất sức và không được ăn.",
  },
  treasure: {
    id: "treasure",
    text: () => "Đã biết chỗ đào kho báu (cột sáng đỏ)! Ai có xẻng tới đó đào, rồi vác rương về trại. Kẻ phản bội sẽ tìm cách cướp.",
  },
  craft: {
    id: "craft",
    text: (t) => `Bạn đã đủ nguyên liệu chế tạo! Bấm ${t ? "nút Chế tạo" : "R"} để làm rìu đá, giáo, đuốc, ván vá thuyền... từ gỗ, đá, da, xương nhặt được.`,
  },
  dead: {
    id: "dead",
    text: () => "Bạn đã thành hồn ma. Vẫn đi xem được; ban đêm có thể phù hộ hoặc quấy người sống, và nói chuyện với các hồn khác.",
  },
};

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TIPS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify([...seen]));
  } catch {
    // Không lưu được thì lần sau hiện lại, không sao.
  }
}

/** Mỗi mẹo hiện một lần, đúng lúc gặp chuyện đó lần đầu. "Tắt mẹo" thì thôi hẳn. */
export function Tips({ room }: { room: IslandRoom }) {
  const me = myId(room);
  const touch = useTouchDevice();
  const { nearAnchor, nearTarget, swimming } = useHud();
  const s = useRoomSnapshot(room, (st) => {
    const self = st.players.get(me);
    return {
      phase: st.phase,
      alive: self?.alive ?? false,
      hungry: (self?.hunger ?? 100) < 35,
      site: !!st.treasureSite && !st.treasureDug,
    };
  });
  const priv = usePrivate();
  const bagItems = priv?.bag.map((b) => b.itemId) ?? [];
  const canCraft = CRAFTABLE.some((item) => Object.keys(missingMaterials(bagItems, item.craft!.needs)).length === 0);
  const seen = useRef(readSeen());
  const [tip, setTip] = useState<Tip | null>(null);

  const wanted: string[] = [];
  const playing = s.phase === "explore" || s.phase === "dawn" || s.phase === "dusk";
  if (!s.alive && s.phase !== "lobby" && s.phase !== "ended" && s.phase !== "create" && s.phase !== "pack") wanted.push("dead");
  else if (s.alive) {
    if (s.phase === "dusk") wanted.push("dusk");
    if (playing) {
      // Mẹo đầu tiên chờ tới lúc thật sự được đi (bình minh còn đang đọc lời kể).
      if (s.phase === "explore") wanted.push("start");
      if (nearAnchor) wanted.push("anchor");
      if (nearTarget?.kind === "tree") wanted.push("tree");
      if (nearTarget?.kind === "item") wanted.push("item");
      if (nearTarget?.kind === "campfire") wanted.push("campfire");
      if (swimming) wanted.push("swim");
      if (s.hungry) wanted.push("hungry");
      if (s.site) wanted.push("treasure");
      if (canCraft) wanted.push("craft");
    }
  }
  const next = wanted.find((id) => !seen.current.has(id) && !seen.current.has("*"));

  useEffect(() => {
    if (tip || !next) return;
    const t = TIPS[next];
    if (!t) return;
    seen.current.add(t.id);
    saveSeen(seen.current);
    setTip(t);
  }, [next, tip]);

  // Tự ẩn sau một lúc; mẹo "bắt đầu" đọc lâu hơn.
  useEffect(() => {
    if (!tip) return;
    const timer = setTimeout(() => setTip(null), tip.id === "start" ? 16000 : 11000);
    return () => clearTimeout(timer);
  }, [tip]);

  if (!tip) return null;
  return (
    <aside className="panel tip" key={tip.id}>
      <Lightbulb size={18} aria-hidden />
      <p>{tip.text(touch)}</p>
      <div className="tip-actions">
        <button className="primary" onClick={() => setTip(null)}>
          Đã hiểu
        </button>
        <button
          className="ghost"
          title="Không hiện mẹo nữa"
          onClick={() => {
            seen.current.add("*");
            saveSeen(seen.current);
            setTip(null);
          }}
        >
          <X size={13} aria-hidden /> Tắt mẹo
        </button>
      </div>
    </aside>
  );
}
