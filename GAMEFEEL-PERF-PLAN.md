# Kế hoạch cải thiện Game Feel / Chuyển động / Performance

Nguồn lý thuyết: [Game Design Guide](https://gamedesign.guide/) — các mục **Theory → Perception** (Game Feel, Feedback),
**Dynamics** (Pacing), **Cognition** (Clarity Mapping). Phương pháp kiểm chứng lấy từ "Mini-Challenge" của site:
quay clip 10 giây → xem slow-motion → tắt hết audio để cảm nhận phần còn lại.

Trạng thái tại thời điểm viết: commit `f40b34d` (nhánh `initialize`).

---

## 0. Tóm tắt

Code hiện tại **đã làm đúng** nhiều thứ quan trọng, cần giữ nguyên khi refactor:

- Input đọc từ module-level `Set` / object, đọc đồng bộ trong `useFrame` — **không** đi qua React state ⇒ 0 độ trễ input.
- Chuyển động ngang dùng `1 - Math.exp(-dt * rate)` — đúng là frame-rate independent.
- `keys.clear()` khi `window.blur` ⇒ không kẹt phím khi alt-tab.
- Chặn spike `|movementX| > 600` của pointer lock (bug Chrome).
- Toàn bộ tiếng động tổng hợp bằng Web Audio, pre-render bank cho đạn, không decode file lúc bắn.
- Casing/decals/puff/tracer đều có trần và ring-buffer.
- IK và vector scratch dùng module scope, không cấp phát `Vector3` trong frame loop.

Nhưng có **5 lỗi đang phá trực tiếp cảm giác**, và profile render **quá nặng cho mục tiêu 60fps trên iGPU tích hợp**.

Ưu tiên theo: P0 (rẻ, tác động lớn) → P1 (thiếu kỹ thuật feel) → P2 (performance) → P3 (clarity).

---

## P0 — Lỗi đang làm hỏng cảm giác

Sửa trong khoảng 40 dòng, không đụng cấu trúc render loop.

### P0-1 · Trượt chân 65–76% ở chế độ khám phá ⭐ ưu tiên cao nhất

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:783`, `apps/client/src/game/Character.tsx:525`

`Character.tsx:523-525` cố ý bám tốc độ thật để chân không trượt:

```ts
// Nhịp bước: biết tốc độ thật thì mỗi bước đi đúng một sải (đi khom sải ngắn, chạy sải dài), chân không trượt trên đất.
const stride = crouching ? 0.5 : m.running ? 1.05 : 0.7;
const rate = m.swimming ? 7 : m.speed !== undefined ? Math.min(24, (Math.PI * m.speed) / stride) : m.running && !crouching ? 17 : 12.5 - 3 * crouch;
```

Nhưng `LocalPlayer.tsx:783` chỉ cấp `speed` ở Battleground:

```ts
localMotion.speed = battle ? hSpeed : undefined;
```

⇒ Ở CHẾ ĐỘ KHÁM PHÁ (mode chính) nhánh `m.speed !== undefined` không bao giờ chạy, rơi về hằng số:

| Chế độ | Tốc độ thật | Nhịp cần `π·speed/stride` | Nhịp thực tế | Trượt chân |
|---|---|---|---|---|
| Đi bộ | 8 m/s | 35.9 rad/s | **12.5** | ~65 % |
| Chạy | 16 m/s | 71.8 rad/s | **17** | ~76 % |
| Battle chạy | 8.6 m/s | 25.7 | 24 (đã chặn trần) | ~7 % |

**Sửa:**

```ts
// apps/client/src/game/LocalPlayer.tsx:783
localMotion.speed = hSpeed;
```

Bỏ ternary. Comment trong `Character.tsx` sẽ lại đúng với code.

> Lưu ý: `Math.min(24, …)` ở `Character.tsx:525` vẫn chặn trần, để lại cặp chân trượt nhẹ ở tốc độ rất cao.
> Tăng trần lên ~40 sau khi đo, hoặc giữ nguyên nếu muốn bước ngắn ở tốc độ cao.

### P0-2 · Bẫy góc dốc 10° không đi nổi

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:155-156`

```ts
c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
```

Hai tham số này độc lập nhau trong Rapier: `max_slope_climb` là dốc tối đa leo được,
`min_slope_slide` là dốc nhẹ nhất bắt đầu trượt xuống. Khi **climb < slide** (đang là 50 < 60) sẽ tồn tại
dải **50°–60° mà người chơi vừa không leo được vừa không trượt xuống** — chỉ đứng yên. Sườn núi lửa
(`Island.tsx:112-113`) dễ tạo đúng góc này.

**Sửa** (thử nghiệm khi chơi):

```ts
c.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
c.setMinSlopeSlideAngle((50 * Math.PI) / 180);
```

⇒ leo được tới 55°, trượt từ 50°. Dải 50–55° vẫn leo được nhưng có trượt nhẹ — đúng như thực tế.

### P0-3 · Tiếng bước chân lệch ~3× so với camera bob

**Vị trí:** `apps/client/src/game/sound/Soundscape.tsx:619-632`

Camera bob chạy ở `LocalPlayer.tsx:722` với `s.stepPhase += dt * (5.2 + hSpeed * 0.9)`:
đi 8 m/s ⇒ 12.4 rad/s ⇒ ~7.9 nhịp chân/giây. Nhưng âm thanh bước chân chạy timer **hoàn toàn riêng**:

```ts
tm.step -= dt;
if (tm.step <= 0 && localMotion.moving) {
  ...
  tm.step = localMotion.running ? 0.28 : 0.42;   // hằng số, không có speed
  play(surfaceSound(world, p.x, p.z), { volume: localMotion.running ? 1 : 0.7 });
}
```

Hai đồng hồ tách rời ⇒ lệch và trôi dần. Ngoài ra:
- `localMotion.speed` có sẵn nhưng timer không dùng.
- `localMotion.moving` ở story mode là cờ **input** (`moving || sliding`), nên đẩy vào tường vẫn phát tiếng chân ở tần số đầy đủ.
- Cổng `p.y - world.heightAt(...) < 0.3` ⇒ ngâm nước >30 cm là **mất hẳn** tiếng bước.

**Sửa:** phát tiếng khi `stepPhase` cắt qua mốc, cadence suy ra từ tốc độ thật.

```ts
// Ưu tiên nhịp bước của animation, nhớ đẩy mốc đã tiêu khi player vừa vào màn.
const cadence = Math.max(0.22, 1 / Math.max(0.6, (Math.PI * Math.max(1, localMotion.speed ?? 0)) / 0.85));
if (m0 >= 0) tm.phase -= cadence * (0.5 + (m0 % 1 >= 0.5 ? 0.5 : 0)); // 2 nhịp mỗi chu kỳ
```

Cách triển khai cụ thể: export `stepPhase` từ `shared.ts`, trong `Soundscape` phát `play(...)` khi
`floor(prevPhase / π) !== floor(stepPhase / π)`, và bỏ `tm.step` cũ.

### P0-4 · Rơi nhanh làm mất bám đất (không có terminal velocity)

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:590`

```ts
s.vy -= (battle ? (s.vy > 0 ? BATTLE_GRAVITY_UP : BATTLE_GRAVITY_DOWN) : GRAVITY) * dt;
```

Không chặn trên `s.vy` ở đâu cả. Rơi 3 giây với `GRAVITY = 25` cho `vy = -75 m/s`; ở `dt = 0.05`
capsule dịch chuyển **3.75 m trong một bước solver** — vượt `enableSnapToGround(0.4)`, nên
`computedGrounded()` nhấp nháy trong lúc rơi nhanh.

Hệ quả: `LocalPlayer.tsx:629-639` tính `stance.land` và `s.dipV` từ `fallSpeed` **không chặn trên** ⇒
camera giật tỉ lệ tuyến tính với con số không giới hạn; và không có coyote time (P0-5) nên hop mất.

**Sửa:**

```ts
s.vy -= (battle ? (s.vy > 0 ? BATTLE_GRAVITY_UP : BATTLE_GRAVITY_DOWN) : GRAVITY) * dt;
if (s.vy < -MAX_FALL) s.vy = -MAX_FALL;   // const MAX_FALL = 55
```

55 m/s × 0.05 s = 2.75 m/step, vẫn dưới ngưỡng an toàn. Đồng thời clamp `fallSpeed` trong logic landing.

### P0-5 · Thiếu coyote time

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:577`, `:622`

```ts
} else if (s.grounded && !frozen && keys.has("Space")) {
```

`s.grounded = controller.computedGrounded()` là cờ thô của Rapier, không có bất kỳ bậc cửa số nào.
Rời mép rồi bấm Space trong ~100 ms cuối cùng → không ăn.

**Sửa:** thêm đồng hồ đếm ngược cập nhật mỗi frame, dùng thay `s.grounded` trong điều kiện nhảy.

```ts
s.coyote = s.grounded ? COYOTE_TIME : Math.max(0, s.coyote - dt);
...
} else if ((s.grounded || s.coyote > 0) && !frozen && keys.has("Space")) {
```

`COYOTE_TIME = 0.12`. Nhảy bằng coyote phải cho `s.hop = 0` để không cộng nhầm tốc độ bhop.

---

## P1 — Thiếu kỹ thuật "feel" (khung phản hồi 100–200 ms)

Guide: *"feedback occurs within ~100–200ms of player input to feel satisfying"*, và game feel
= **input + simulation + animation + sound + VFX + camera**. Dưới đây là những trục đang thiếu.

### P1-1 · Không có input buffer (bấm bị nuốt im lặng)

**Vị trí:** `apps/client/src/game/battle/Shooter.tsx:344, 437, 457`

```ts
if (!def || gun.reloadUntil > performance.now()) return;   // :344  R trong lúc đang nạp → mất
if (stance.sprinting || now < gun.readyAt) return;         // :437  click trong lúc swap → mất
if (reloading || gun.healUntil > now) return;              // :457  click trong lúc nạp → mất
```

Tệ nhất: `inp.firePressed = false` được **consume ở `:436`, trước** khi kiểm tra `reloading` ở `:457`
⇒ click bị nuốt trọn vẹn, không phát lại. Đây là loại lỗi người chơi mô tả là "game lag",
chứ không phải "game thiếu tính năng".

**Sửa:** giữ một hàng đợi input ngắn.

```ts
// Giữ input tối đa ~180ms rồi mới trả lại, để bấm trong lúc reload/swap không mất.
inp.firePressedAt = now;   // ở nơi đặt firePressed = true
...
if (reloading || now < gun.readyAt) return;
// …sau khi trạng thái cho phép bắn:
const buffered = inp.firePressedAt && now - inp.firePressedAt < 180;
inp.firePressedAt = 0;
if (!def.auto && !inp.firePressed && !buffered) return;
```

Làm tương tự cho `reload` (buffer đến hết thời gian nạp) và ADS.

### P1-2 · Tần suất bắn bị lượng tử hoá frame

**Vị trí:** `apps/client/src/game/battle/Shooter.tsx:458`

```ts
if (now - gun.lastShot < 60000 / def.rpm) return;
```

Cổng này được đánh giá **một lần mỗi frame render**, không có accumulator. Khoảng thực tế thành
`ceil(interval / frameTime) * frameTime` ⇒ **tần số thấp hơn con số trong content, tỉ lệ tăng khi FPS giảm**:

| Súng | rpm | Chu kỳ thiết kế | @60fps | @30fps |
|---|---|---|---|---|
| Vector | 1100 | 54.5 ms | 66.8 ms → **898 rpm** | 66.8 ms → 898 rpm |
| M416 | 700 | 85.7 ms | 100.2 ms → 599 rpm | 100.2 ms → 599 rpm |
| M249 | 750 | 80 ms | 83.5 ms → 718 rpm | 100.2 ms → **599 rpm** |
| AKM | 600 | 100 ms | 100.2 ms → 599 rpm | 116.8 ms → 514 rpm |

**Sửa:** lịch mốc thời gian thay vì so sánh khoảng cách, và cho phép bắn bù trong cùng frame.

```ts
// Đặt lịch, không so sánh, để RPM trung bình đúng ở mọi tần số khung hình.
const interval = 60000 / def.rpm;
if (now < gun.nextShotAt) return;
gun.nextShotAt = Math.max(gun.nextShotAt + interval, now);
// …trong vòng lặp frame, phát tối đa N viên cho bù lệch khung hình:
for (let n = 0; n < 3 && now >= gun.nextShotAt; n++) { shootOne(); gun.nextShotAt += interval; }
```

Giữ trần 3 viên/khung để một frame 200 ms không dội 4 loạt.

### P1-3 · Không có hitstop

Không có `timeScale` / `hitstop` nào trong toàn bộ client. Guide liệt kê hitstop /
freeze-frame là công cụ chuẩn để tạo **impact**.

**Sửa:** một `hitStop` trong `battle/runtime.ts`, nhân `dt` khi bắn trúng/giết:

```ts
export const hitStop = { until: 0 };
// trong Shooter khi có hit:
hitStop.until = performance.now() + (kind === "kill" ? 90 : 45);
```

Trong `useFrame` của `Shooter`/`LocalPlayer`/`Character`: `const dt = Math.min(rawDt, 0.05) * (now < hitStop.until ? 0.15 : 1)`.
Chỉ nhân **logic/VFX**, không nhân HUD và không nhân âm thanh — như vậy vẫn nghe rõ tiếng.

### P1-4 · Hitmarker chờ 1 RTT

**Vị trí:** `apps/client/src/game/battle/Shooter.tsx:276` (server) vs `:604` (client)

Máu và VFX hiện ngay tại client (`:606-616`), nhưng hitmarker bật từ message server nên trễ 1 RTT.
Server đã **tự kiểm lại đường đạn** (`BattleRoom.ts:611-636`) nên va chạm client đáng tin, chỉ cần
server giữ quyền quyết định cuối.

**Sửa:** client bật hitmarker ngay ở `:604` (optimistic), để message server **xác nhận hoặc huỷ**
(thay vì bật lại). Hoặc đơn giản hơn: gửi `hit` của chính người bắn trong cùng batch.

### P1-5 · Camera shake là nhiễu trắng mỗi frame

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:767-773`

```ts
if (shake.amount > 0.005) {
  const a = shake.amount * 0.35;
  state.camera.position.x += (Math.random() - 0.5) * a;
  ...
}
```

`Math.random()` mới mỗi khung, không lọc ⇒ **tính chất của rung đổi theo FPS**: 144Hz rung mịn như buzz,
30Hz rung đục như đấm. Biên độ lại nhân đều cho cả 3 trục, không có thành phần xoay.

**Sửa:** nhiễu 1D có điều lọc + rung xoay (roll/yaw thay vì chỉ tịnh tiến).

```ts
// Nhiễu value-noise: 2 số ngẫu nhiên nội suy mượt, lấy mẫu theo thời gian chứ không theo khung hình.
const n = (t: number, seed: number) => { /* lerp(hash(seed, floor t), hash(seed, ceil t)) */ };
state.camera.position.x += n(t * 34, 1) * a;
state.camera.position.y += n(t * 31, 2) * a;
state.camera.rotateZ(n(t * 29, 3) * a * 0.5);   // rung xoay đọc được hơn rung tịnh tiến
```

### P1-6 · Head bob đóng băng giữa chừng khi dừng

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:722`

```ts
if (s.grounded && !s.swimming && hSpeed > 0.5) s.stepPhase += dt * (5.2 + hSpeed * 0.9);
```

Khi dừng, phase **đứng yên ở một góc bất kỳ** thay vì trả về 0 ⇒ camera "cụp" mỗi lần start/stop,
và tư thế dừng khác nhau mỗi lần chạy.

**Sửa:** nội suy `stepPhase` về bội số gần nhất của π khi `stepAmt` về 0.

```ts
const near = Math.round(s.stepPhase / Math.PI) * Math.PI;
if (stepAmt < 0.05) s.stepPhase += (near - s.stepPhase) * Math.min(1, dt * 10);
```

### P1-7 · Thiếu phản hồi khi trúng đòn

**Vị trí:** `apps/client/src/game/battle/BattleHud.tsx:177`

Chỉ có vignette đỏ khi HP < 30. Không có:
- **flash đỏ khi bị đánh** (guide: feedback nhiều kênh — hình + âm)
- **damage number** — `HitMessage.amount` đã có trong `packages/protocol/src/index.ts:728`
  và **không component nào đọc**; survival mode đã có (`Fx.tsx:172`) nhưng battle không mount
- phân biệt trúng giáp: `HitMessage.armor` cũng được truyền xuống rồi bị `Reticle` bỏ qua

**Sửa (rẻ, hiệu quả cao):** thêm lớp overlay trong `BattleHud` — flash đỏ 120ms + damage number
bám theo hướng sát thương + crosshair đổi màu khi trúng giáp.

### P1-8 · Thiếu FOV kick khi sprint; setting FOV chết ở story mode

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:703-713`

```ts
const baseFov = battle ? getSettings().fov : 60;
```

`DEFAULT_SETTINGS.fov = 70` (`settings.ts:24`) nhưng story mode hardcode `60`, Canvas cũng tạo `fov: 60`
(`Game.tsx:134`) ⇒ **đổi setting FOV trong chế độ khám phá không có tác dụng gì**, im lặng.

Ngoài ra **không có FOV kick khi sprint** ở chế độ nào.

**Sửa:** dùng setting ở cả hai mode, cộng kick khi sprint:

```ts
const baseFov = getSettings().fov;
const kick = running && !battle ? 1.06 : 1;      // story: sprint kick
const mag = battle && stance.aiming ? (scoped ? zoom : Math.max(1.15, zoom)) : kick;
```

### P1-9 · Sprint → bắn bị chặn cứng, không có raise-time

**Vị trí:** `apps/client/src/game/battle/Shooter.tsx:437`

```ts
if (stance.sprinting || now < gun.readyAt) return;
```

Bỏ Shift là bắn được ngay khung sau. Đổi súng có `gun.readyAt` 0.35–0.75s, nhưng rút súng từ sprint
thì không — thiếu cả raise-time lẫn hiệu ứng "lỡ tay" (stumble). Cho `gun.raiseAt` khi
vừa ngừng sprint, kèm penalty shot đầu ở độ trệt cao hơn.

### P1-10 · Khoảnh khắc dừng leg giữa sải

**Vị trí:** `apps/client/src/game/Character.tsx:526`

```ts
a.phase += dt * rate * (a.amount > 0.05 || m.swimming ? 1 : 0);
```

`a.amount` tắt dần (τ ≈ 100ms) nên phase đứng yên ở góc ngẫu nhiên. Cùng nguyên nhân với P1-6.
Sửa chung: khi thoát nhịp, nội suy phase về bội số π gần nhất.

### P1-11 · Mũi tên nhìn và melee dùng `look.yaw`, camera dùng `view.yaw`

**Vị trí:** `Controls.tsx:59,67,74,77` vs `LocalPlayer.tsx:671`

`input.ts:27-29` có smoothing `τ = 8 + k·0.037` ms (mặc định k=0.35 ⇒ ~21ms), nên camera
**đi sau** chuột. Nhưng `Messages.attack` / `Messages.throw` dùng `look.yaw` thô, còn camera và
hướng avatar dùng `view.yaw`. Khi flick nhanh, đòn melee có thể trúng ngoài tầm nhìn.

**Sửa:** dùng `view.yaw` cho mọi hành động bắn/chém/ném.

### P1-12 · `dt` không chặn ở `Character.tsx` và `FirstPerson.tsx`

**Vị trí:** `Character.tsx:486,503,526`, `FirstPerson.tsx:30-36`

`LocalPlayer.tsx:359` có `Math.min(rawDt, 0.05)` nhưng hai file này dùng `dt` thô. Sau khi
tab-switch, `a.actT += dt` vượt `ACT_SECONDS` trong một bước ⇒ **mọi hành động một lần
(swing/chop/throw/shoot/stab) bị bỏ qua hoàn toàn, không phát ra gì cả**. Chân nhảy sang phase ngẫu nhiên.

**Sửa:** chặn `dt` giống hệt:

```ts
useFrame((_, raw) => { const dt = Math.min(raw, 0.05); /* … */ });
```

### P1-13 · Replay hành vi vật lý khi physics step chạy trước

**Vị trí:** `Game.tsx:159` + `LocalPlayer.tsx:667`

`<Physics timeStep="vary">` khiến R3F tắt interpolation (Rapier đặt `interpolationAlpha = 1`).
Thêm vào đó, `FrameStepper` mount trước children nên `world.step()` chạy **trước** `useFrame` của
`LocalPlayer`. Mà `setNextKinematicTranslation` chỉ áp dụng ở step **kế tiếp** ⇒ avatar mesh
trễ camera đúng một khung (~0.27m ở 16 m/s). Comment ở `LocalPlayer.tsx:737-738` khẳng định
ngược lại là không đúng. Thứ tự này còn **mong manh**: bọc `<LocalPlayer/>` trong subtree khác
là lệch hoặc nhân đôi.

**Sửa:** cho `useFrame` của LocalPlayer `priority = -1` để thứ tự tường minh, hoặc chạy physics
với timestep cố định (`timeStep={1/60}`) để bật lại interpolation.

### P1-14 · `setHud` re-render toàn bộ HUD ~12 lần/giây vĩnh viễn

**Vị trí:** `LocalPlayer.tsx:859` + `apps/client/src/game/hudStore.ts:72-82`

```ts
sprint: Math.round(s.energy),
```

`s.energy` hồi liên tục ở `SPRINT_REGEN = 12`/s (`:414`) ⇒ `Math.round` đổi giá trị ~12 lần/giây **vĩnh viễn**.
`setHud` so sánh 18 key rồi thay state ⇒ mọi subscriber của `useHud()` render lại ~12 lần/giây,
cộng thêm vòng `Object.keys().every()` ở **mỗi** frame 60fps.

**Sửa:** tách thanh stamina ra khỏi store chung — render trực tiếp bằng CSS transform
(ref + `style`), chỉ đẩy vào store khi trạng thái rút ràng buộc (đầy/cạn) thay đổi.

### P1-15 · Ghi chú sai lệch về hằng số chuyển động

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx:121-126`

Comment ghi Battleground *"nặng tay hơn chế độ khám phá"* nhưng `GROUND_ACCEL/GROUND_BRAKE` (11/12)
**nhỏ hơn** `STORY_ACCEL/STORY_BRAKE` (13/16) ⇒ battle nhẹ hơn. Sửa comment hoặc sửa hằng số,
đừng để lại — ai đọc sau sẽ tinh chỉnh sai.

---

## P2 — Performance

Mục tiêu: 60fps trên iGPU tích hợp laptop, build 30MB (không nén).

### P2-1 · Terrain 100 mesh + 100 `TrimeshCollider` ⭐ ưu tiên cao nhất

**Vị trí:** `apps/client/src/game/Island.tsx:44-45, 371-382`

```ts
const CHUNK = 48;   // MAP_HALF_SIZE = 240  →  (240*2)/48 = 10  →  10 × 10 = 100
```

100 `<mesh>` (draw call) và **100 `TrimeshCollider`** — mỗi chunk mịn có 24×24×2 = 1 152 tam giác
⇒ **~115 000 tam giác trong thế giới vật lý**, mỗi trimesh một BVH, step mỗi frame.
Đây gần như chắc là CPU cost lớn nhất mỗi khung. Battleground dùng chung code ⇒ cũng 100.

**Sửa:**
- Draw call: tăng `CHUNK` lên 96–128 (→ 16–25 mesh) hoặc gộp thành 1 mesh với index phân vùng.
- Physics: dùng **1–9 `TrimeshCollider`** thay vì 100, chia theo vùng thô để vẫn giữ BVH nhỏ.

Cần đo trước/sau bằng React DevTools Profiler + `performance` panel.

### P2-2 · Không có adaptive quality — iGPU mặc định chạy tier `high`

**Vị trí:** `apps/client/src/game/graphics.ts:16-18`, `apps/client/src/game/Game.tsx:78-108, 134-154`

```ts
const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
return weak ? "low" : "high";
```

Laptop iGPU (Intel Iris Xe, 8–16 nhân, con trỏ chuột) → **`high`**. `hardwareConcurrency` đo CPU,
**không phải fill rate của GPU**. Từ "performance monitor" grep ra **0 kết quả** trong cả repo.

Tier `high` bật đồng thời:
- `dpr={[1,2]}` ⇒ trên màn HiDPI render **gấp 4× số pixel**
- **7 pass hậu kỳ**: N8AO + Bloom(mipmap) + AGX ToneMapping + HueSaturation + BrightnessContrast + Vignette + SMAA
- Shadow map **4096² PCF**, `shadow-radius={4}` ⇒ 5 tap/fragment, vẽ lại **mỗi frame**
  (`DayCycle.tsx:139` dịch nguồn sáng mỗi frame nên không thể `autoUpdate = false`)
- 4 point light (island) / 6 (battle) — **không bao giờ bị gỡ**, nên `NUM_POINT_LIGHTS` bị bake
  vào **mọi** `MeshStandardMaterial`, kể cả khi đứng cách hang sâu 200m
- Toàn scene gần như **100% `MeshStandardMaterial`** (không có Lambert/Phong/Toon nào)

**Sửa:** thêm 3 tier + theo dõi thời gian thực.

```tsx
import { PerformanceMonitor } from '@react-three/drei';
<PerformanceMonitor onDecline={() => setQuality('medium')} onIncline={() => setQuality('high')}>
```

Tách `high` thành `high` / `medium` / `low`, `medium` = dpr `[1, 1.5]`, shadow 2048, bỏ N8AO,
`low` thêm `MeshLambertMaterial` cho vegetation và giảm `NUM_POINT_LIGHTS`.

Cũng nên bỏ `shadow-blurSamples={12}` — chỉ VSM đọc, với PCF là **config chết**.

### P2-3 · `JSON.stringify` × 34 mỗi state tick

**Vị trí:** `apps/client/src/game/useRoomSnapshot.ts:22-27`

```ts
const getSnapshot = () => {
  const value = selectRef.current(room.state);
  const json = JSON.stringify(value);
  if (cache.current?.json !== json) cache.current = { json, value };
  return cache.current.value;
};
```

Có **34 call site** `useRoomSnapshot()`. `getSnapshot` chạy mỗi render **và** mỗi `onStateChange`.
Nhiều selector build array/object mới mỗi lần gọi (`Minimap.tsx:40-60` tạo **năm** array;
`Points.tsx:529-533`; `Camp.tsx:273-275`; `Trees.tsx:401-404`) ⇒ mỗi tick 15–20Hz có **34 lần
stringify các object lớn**.

**Sửa:** so sánh theo tham chiếu / phiên bản thay vì stringify.

```ts
// Chỉ stringify khi phần state quan tâm thật sự đổi, theo bản chữ ký ngắn.
const sig = `${s.players.size}:${s.phase}:${s.clockTick}:${s.items.length}`;
if (sig !== cache.current?.sig) { cache.current = { sig, value: selectRef.current(room.state) }; }
```

Tốt hơn nữa: bỏ `useRoomSnapshot` ở các component không cần re-render, thay bằng subscription
chọn lọc cho từng field.

### P2-4 · Upload ma trận instance vô điều kiện (~4000 lần/frame)

**Vị trí:** `Weather.tsx:84-113` (mưa 1600), `Weather.tsx:154-170` (tuyết 2400), `Fx.tsx:145-158`, `Trails.tsx:107-146`

```ts
for (let i = 0; i < count; i++) {
  const d = drops[i]!;
  if (i >= visible) { dummy.scale.setScalar(0); }
  else { /* … */ }
  dummy.updateMatrix();
  m.setMatrixAt(i, dummy.matrix);
}
m.instanceMatrix.needsUpdate = true;
```

Kể cả khi **trời quang**, 1600 + 2400 = 4000 `updateMatrix` + `setMatrixAt` + upload **mỗi frame**.
`visible` chỉ giảm mô phỏng, không giảm upload.

**Sửa:** theo dõi `visible` đã đổi chưa; khi vượt ngưỡng, chỉ cần tẩy 1 instance thay vì
ghi toàn bộ mảng.

```ts
if (visible !== prev.current) { /* tẩy/viết lại phần biên */ prev.current = visible; }
else m.instanceMatrix.needsUpdate = false;
```

Và **không render hệ mưa/tuyết khi `intensity` = 0** (mount có điều kiện).

### P2-5 · Cấp phát bộ nhớ mỗi frame trong hot loop

**Vị trí:** `apps/client/src/game/LocalPlayer.tsx`

| Dòng | Cấp phát | Ghi chú |
|---|---|---|
| `:618` | `{ x, y, z }` literal | object mỗi frame cho `computeColliderMovement` |
| `:736` | `new rapier.Ray(...)` | **vẫn chạy cả ở first-person**, xong bị `:750` ghi đè kết quả |
| `:816-817` | `[...sheet.items]` rồi 2 lần `.includes()` | copy cả mảng đồ vật mỗi frame |
| `:943` | `new Set(state.discovered)` | mỗi frame trong `nearestTarget` |
| `:943, 990` | `climbTrees()` → `[...standingCache.trees]` | copy **toàn bộ** mảng cây mỗi frame |
| `:848` | `setHud({...14 key})` | patch 14 key mỗi frame (xem P1-14) |
| `:494` | closure `campDist` | mỗi frame |

**Sửa:** đưa tất cả ra module scope / `useRef`. Riêng P0-5 (xuống) nên **bỏ hẳn ray camera ở
first-person**:

```ts
if (!firstPerson) { /* orbit + castRay chặn vật cản */ }   // hiện đang chạy vô điều kiện
```

`nearestAnchor` / `nearestTarget` / `nearestVictim` / `nearestPlayer` (`:847-858`) đều quét
toàn bộ `pois`, `creatures`, `groundItems`, `pages`, `trees`, `players` **mỗi frame** — nên cache
kết quả ở tần số thấp hơn (ví dụ 10Hz) thay vì 60Hz.

### P2-6 · Không code-split, Rapier wasm base64 2.1MB

**Vị trí:** `apps/client/vite.config.ts` (cả file 8 dòng), `apps/client/src/main.tsx`

Không có `build.target`, `manualChunks`, `assetsInlineLimit`. **Toàn bộ** app nằm trong một chunk:
cả Battleground (`Shooter` 33KB, `ViewModel` 28KB, `GunModel` 49KB, `BattleHud` 36KB,
`Effects` 31KB) dù người chơi chỉ chơi story mode.

Grep `import(` / `React.lazy` trong `apps/client/src` chỉ ra **type import** — không có dynamic
import nào cả. `@dimforge/rapier3d-compat` inline `rapier_wasm3d_bg.wasm` (1.57MB) thành base64
⇒ **~2.1MB base64 trong một module JS**.

**Sửa:**

```ts
// vite.config.ts
build: {
  target: 'es2022',
  rollupOptions: {
    output: {
      manualChunks: {
        three: ['three', '@react-three/fiber', '@react-three/drei'],
        rapier: ['@dimforge/rapier3d-compat', '@react-three/rapier'],
        post: ['@react-three/postprocessing', 'postprocessing', 'n8ao'],
      },
    },
  },
},
```

Và lazy-load route Battleground bằng `React.lazy(() => import('./game/battle/...'))`.

### P2-7 · Overdraw nặng: water + sky

- **Water** `Water.tsx:316, 372`: lưới cực 360×360 = **259 200 tam giác**, `DoubleSide`,
  `transparent`, `frustumCulled={false}`.
- **Sky** `Sky.tsx:127-131, 174`: fbm 6 octave × 2 + sao, fullscreen, `renderOrder={-1}` (vẽ trước
  ⇒ toàn bộ pixel bị ghi đè), `frustumCulled={false}`.
- `Game.tsx:134` đặt `far: 500` trong khi fog kết thúc ở 230 (`DayCycle.tsx:123`) ⇒ **~55 % mặt phẳng
  xa là overdraw thuần**.

**Sửa:** giảm lưới nước về 200–240, `far` → 300, và tính fbm sky ở **1/2 hoặc 1/4 độ phân giải**
rồi upscale (sky gần như không đổi khi chuyển động nhanh).

### P2-8 · 8/15 loại thực vật không có distance cull

**Vị trí:** `apps/client/src/game/Vegetation.tsx:484-496`, `:321-329`

CELL = 72 ⇒ island 4×4 cell, battle 6×6 cell; 15 nhóm `<Instances>` ⇒ **~240 (island) đến
~540 (battle) `InstancedMesh`**. Tổng ~26 000 instance ở tier `high`.

Trong `useFrame` của `Instances`, các nhóm **không có** thuộc tính `farthest` (8/15: `tall`,
`bushes` leaves+core, `rocks`, `driftwood`, `bananaStem`, `bananaLeaves`, `pandans`) làm
`if (!farthest) return;` ⇒ chỉ dựa vào frustum culling của three.js, tức **mọi cell 72m nằm trong
tầm với đều được vẽ**.

**Sửa:** đặt `farthest` cho cả 8 nhóm còn lại (giá trị lớn hơn, ví dụ 160–220m vì chúng to hơn cỏ).

### P2-9 · `<mesh>` riêng cho từng object lặp lại

| Vị trí | Draw call |
|---|---|
| `Character.tsx:411-412` (37 `<P>`) | **37 mỗi nhân vật** × N người chơi |
| `Wildlife.tsx:430-434` | 5–20 mỗi sinh vật × **~40–70 sinh vật** |
| `Points.tsx:31-65` | 1 mỗi mesh POI (`sea_glass`=30, `fairy_ring`=22, `carved_wall`=13 …) |
| `ItemModel.tsx` × `Items3D.tsx:92` | 1–5 mỗi vật phẩm rơi trên mặt đất |
| `Landmarks.tsx`, `Camp.tsx:60-84` | 5–10 mỗi công trình |

Ước tính **700–1 100 draw call** ở giữa bản đồ tier `high`, chưa kể shadow pass.

**Sửa:** gộp geometry tĩnh vào 1 `BufferGeometry` cho toàn bộ POI/landmark đặc hữu; ghép body
nhân vật thành vài mesh theo vật liệu (da / vải / kim loại) thay vì 37.

### P2-10 · Frame spike định kỳ từ PMREM

**Vị trí:** `apps/client/src/game/Sky.tsx:181, 220-230`

```ts
const ENV_INTERVAL = 1.5;
// rig.camera.update(gl, rig.envScene);  → pmrem.fromCubemap(...)
```

Render target có tái dùng (tốt), nhưng vẫn chạy 6 face + chuỗi blur mỗi **1.5 giây** ⇒ spike đều đặn.

**Sửa:** tăng lên 4–6s, và **snap** khi bật/tắt tab. Hoặc chỉ cập nhật IBL khi mặt trời dịch
đủ ngưỡng (ví dụ mỗi 3°).

### P2-11 · Đếm draw call & ghi chú đo đạc

Cần `WebGLRenderer.info` để theo dõi `render.calls`, `render.triangles`, `programs.length` và
`memory.geometries`. Bật/tắt qua `?debug=1` cùng cảnh hiện có
(`LocalPlayer.tsx:775` đã có nhánh `import.meta.env.DEV && debugCam.enabled` — theo mẫu đó).

**Sửa dỗi khó chịu, không tốn hiệu năng:**
- `LocalPlayer.tsx:868` `s.sendTimer = 0` ⇒ sai số cố định ~4 % trên tần số gửi 15Hz.
  Đổi thành `s.sendTimer -= SEND_INTERVAL`.
- `LocalPlayer.tsx:849` gọi `room.state.players.get(myId(room))` 3 lần/frame (+1 lần mỗi render
  ở `:140`) — cache 1 lần.
- `battle/ItemIcons.tsx:46-72` tạo **WebGLRenderer thứ hai** + `PMREMGenerator`/`RoomEnvironment`
  trong suốt trận. Chuyển sang render icon ra texture 1 lần rồi dùng lại, hoặc vẽ bằng DOM/SVG.
- `battle/Effects.tsx:237` vượt cap 900 `puffs` chỉ `continue` (bỏ qua ghi ma trận, **không** bỏ
  tích phân) ⇒ khói kéo dài sẽ nuốt VFX mới. Nên **loại bỏ phần tử cũ** thay vì `continue`.

---

## P3 — Clarity Mapping

Guide: *"hiển thị đúng thứ, đúng chỗ, đúng lúc"*; *"một cơ chế có thể hay nhưng không có clarity
mapping thì người chơi sẽ không bao giờ học cách dùng nó"*.

### P3-1 · Client và server bất đồng về headshot

- Client `Shooter.tsx:86-118`: head = **sphere r=0.15** tại `b.y + 1.62` (đứng) ⇒ biên 1.47–1.77m.
- Server `BattleRoom.ts:630-632`: head = `py > target.y + height - 0.55`, `height = 1.8` (đứng)
  ⇒ biên **1.25–1.80m**.

Một phát bắn vào **1.5m**: client phân loại *thân*, server phân loại *đầu* — và **server thắng
trong im lặng** (`:624` chỉ `continue`, không gửi thông báo nào về client).
Chênh lệch ~18cm ở chiều cao đứng.

**Sửa:** dùng chung **một** mô hình hitbox ở `packages/protocol` hoặc `packages/content`, và
server trả về kết quả phân loại để client tự sửa hitmarker (khớp với P1-4).

### P3-2 · Crosshair gap dùng hằng số cứng

**Vị trí:** `apps/client/src/game/battle/BattleHud.tsx:154`

```ts
const gap = Math.max(3, Math.min(60, stance.spread * 900 / (stance.aiming ? stance.zoom : 1)));
```

Hằng số `900` giả định FOV 70. Ở FOV 100, crosshair **báo độ rộng thiếu ~30 %** so với góc tán
thực. Ngoài ra `useFrameTick(60)` ⇒ 60 lần re-render React/giây cho subtree crosshair.

**Sửa:** ánh xạ radian → pixel bằng `tan`:

```ts
const pxPerRad = (window.innerHeight / 2) / Math.tan((fov * Math.PI / 180) / 2);
const gap = Math.max(3, Math.min(60, Math.tan(stance.spread) * pxPerRad * 1000));
```

Và giảm `useFrameTick(60)` → 30, hoặc viết trực tiếp vào CSS custom property qua ref.

### P3-3 · Server âm thầm nuốt đòn bắn bị từ chối

**Vị trí:** `BattleRoom.ts:596-602`

Thứ tự hiện tại: trừ đạn → cập nhật `lastShotAt` → hủy heal → **rồi mới** kiểm tra gốc nòng.
Một phát bắn bị từ chối vì gốc nòng sai **vẫn mất một viên** và vẫn chiếm slot tần số, nhưng
**không** phát `shot` cho người khác ⇒ âm thanh/hình ảnh chỉ có ở máy người bắn.

**Sửa:** kiểm tra gốc nòng **trước** khi trừ đạn; và gửi `Messages.reject` để client báo
"không bắn được" thay vì im lặng.

### P3-4 · Điểm chết cảm giác: không có phân biệt trúng giáp ở crosshair

`HitMessage.armor` được truyền xuống rồi lưu vào `hud.hit` (`Shooter.tsx:278`) nhưng `Reticle`
**không đọc**. Người chơi không biết mình bắn vào giáp hay thân.

**Sửa:** crosshair đổi hình khi `armor` (ví dụ viền xám thay vì trắng) + tiếng riêng
(`playArmorHit` đã có sẵn ở `Shooter.tsx:284`).

### P3-5 · Thiếu "học bằng chơi" (guide: feedback nên dạy không cần chữ)

Các trạng thái hiện chưa được báo bằng tín hiệu:
- Không có khoảng trống đạn (shell-chamber / chamber check).
- Không có thanh **magazine nạp dần** khi nạp (hiện chỉ có tiếng).
- Không có highlight vật phẩm theo mức **tương thích** với vũ khí đang cầm.

Mỗi thứ đều giảm **cognitive load** và giúp người chơi tự học (`Backpack Battles` dùng hình sao/kim
cương; guide nhắc "signals should teach without extra text").

---

## Quy trình kiểm chứng

Làm theo "Mini-Challenge" của guide, không đoán:

1. **Clip 10 giây** cho mỗi cơ chế ở P0/P1, xem **slow-motion**:
   - Input có khớp output ngay lập tức không?
   - VFX và âm thanh có củng cố cho hành động không?
   - Phóng đại một yếu tố có làm rõ hay làm rối?
2. **Tắt toàn bộ audio**, chơi lại → phần nào mất cảm giác nhất? (thường là bước chân)
3. **Đo trước/sau** P2-1 và P2-2 bằng `renderer.info` + tab Performance:
   ghi lại `render.calls`, `render.triangles`, `programs.length`, fps trung bình và fps thấp nhất.
4. **Chạy `pnpm test` và `pnpm typecheck`** sau mỗi nhóm thay đổi.

### Definition of Done

- [ ] P0-1: nhịp chân khớp quãng đường ở **cả** story và battle (nhìn bằng mắt, chân không trượt).
- [ ] P0-2: đi lên được sườn núi lửa ở mọi góc, không mắc kẹt ở dải 50–60°.
- [ ] P0-3: tiếng bước chân khớp từng nhịp với camera bob khi đi và khi chạy.
- [ ] P0-4: nhảy liên tục ở cuối vực sâu không bị mất bám đất.
- [ ] P0-5: bấm Space hơi trễ sau khi rời mép vẫn nhảy được.
- [ ] P1: click trong lúc reload/swap **không bị mất**.
- [ ] P1: RPM thực tế trong game khớp content ở cả 60fps và 30fps.
- [ ] P1: trúng đòn/hạ đối thủ có hitstop nhìn thấy được.
- [ ] P1: rung camera cho **cùng một cảm giác** ở 30fps và 144fps.
- [ ] P2-1: số draw call của terrain giảm từ 100; tổng tam giác physics giảm rõ rệt.
- [ ] P2-2: có adaptive quality; laptop iGPU không còn chạy tier `high` với dpr 2 + 7 pass.
- [ ] P2-3: không còn `JSON.stringify` mỗi state tick.
- [ ] P2-6: build tách chunk, route Battleground lazy-load.
- [ ] P3-1: phân loại head/body của client và server luôn khớp.

---

## Ghi chú cho người tiếp nhận

- **Giữ nguyên** mọi thứ liệt kê ở mục "Tóm tắt" (input store, `exp` smoothing, `keys.clear()`
  khi blur, guard `movementX`, pre-render audio bank, trần + ring-buffer cho particle).
- Comment trong code viết tiếng Việt — giữ nguyên giọng khi sửa.
- P0-1 và P0-3 **nên làm cùng nhau**: cùng sửa `localMotion.speed`, cùng chạm vào hệ nhịp bước.
- Đừng refactor `LocalPlayer.tsx` (1 065 dòng, ~530 dòng là một `useFrame`) trong lúc đang sửa
  P0/P1. Tách hàm sau khi các fix nhỏ đã lên và test ổn định.
