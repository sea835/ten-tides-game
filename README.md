# TEN TIDES

Game co-op 3D sống sót 10 ngày trên đảo, chạy trên trình duyệt. Mô tả thiết kế đầy đủ ở [PROJECT.md](PROJECT.md).

Hiện tại: **graybox giai đoạn 1** với phần lớn tính năng của MVP.

- **Chuẩn bị:** tạo nhân vật (chia điểm, 8 xuất thân, 6 tật xấu, dòng tự mô tả, màu áo), rồi mua đồ và xếp balo 16x16 (xoay, ngăn bí mật, đồ đặt cạnh nhau tạo hiệu ứng, giới hạn ô, trọng lượng và ngân sách).
- **Ban ngày:** khám phá đảo 4 vùng theo thời gian thực. Mỗi sáng engine xếp tối đa 7 thẻ (trong kho 57 thẻ, có thẻ theo thời tiết và chuỗi thẻ nối nhau) vào 19 điểm trên map: rừng dừa, bãi trôi dạt, hồ, hang, núi lửa, xác tàu đắm, phế tích trong rừng, mỏm đá tổ chim, suối nước nóng, rìa trại; xúc xắc công khai kèm các khoản cộng, tỷ lệ % trước khi chọn, và "vì sao thua" sau khi trượt. Có bản đồ nhỏ và cảnh báo không kịp về trại.
- **Thế giới theo seed:** quanh đảo chính là vùng biển 480x480 m với 4–6 đảo nhỏ (cồn cát, đảo rừng, đảo đá, đảo cát đen, đảo vòng), rạn san hô để lặn, 2–3 hang động và 1–2 hầm mỏ, chừng 15 easter egg, 5–7 điểm bất thường, bẫy và 19 loài sinh vật (thân thiện, trung tính, nguy hiểm; quen, lạ, biến dị). Bơi và lặn được, nín thở có giới hạn. Cùng seed bản đồ là cùng thế giới; chủ phòng nhập hoặc gieo seed ở sảnh chờ.
- **Tay chân:** cầm bất kỳ món nào trong balo lên tay (thanh đồ nghề giữa đáy màn hình) để đánh, bắn, ném, ăn, trồng cây; đặt đồ xuống đất, nhặt đồ người khác đánh rơi. Đánh nhau có chữ tượng thanh bay lên, số Máu mất, mảnh vụn văng, rung màn hình, bật lùi; ba trạng thái choáng (đứng hình), chóng mặt (đi loạng choạng, màn hình nghiêng ngả), mù (tối sầm). Leo cây (nhân vật ôm thân cây, chổng mông ra ngoài), chặt cây lấy gỗ, dừa, cây giống rồi trồng lại; đang leo mà cây bị đốn thì té mất Máu. Thú vật đánh chết được và rơi đồ (thịt, da, lông, xương, túi mực…), có con leo cây, bay lên hay lặn xuống để trốn; bơi ra khơi lâu thì có thể gặp cá mập. Dựng chòi lá, nhà sàn, hàng rào quanh lửa trại (ngủ trong nhà thì đỡ mất Tinh thần); nhổ lửa trại mang đi chỗ khác thì cả khu nhà dời theo. Kẻ phản bội có nút kết liễu một đòn, mỗi ngày một lần, không ai biết là ai cho tới màn lật bài.
- **Cốt truyện có hệ quả thật:** bình minh ngày 5 luôn có một biến cố (có người tới trước, bản đồ phải đọc ngược, người giấu còn sống, một đoàn khác trên đảo, núi lửa tỉnh sớm, kho báu có bẫy, mất mái chèo, họ hàng của người giấu) do engine chọn từ đầu ván: nó đổi chỉ số của đội và mở ra thẻ sự kiện nối tiếp, còn bộ sinh truyện dựng cả cốt truyện quanh nó. Mỗi ngày có một trang nhật ký của người xưa nằm đâu đó trên đảo, nhặt được thì thêm manh mối và một mảnh truyện. Ngủ ngoài trại thì gặp chuyện trong đêm (thú rình, mưa dầm, thủy triều, trời đầy sao...). Săn, hái được gì thì nướng ở lửa trại hoặc góp vào kho lương thực chung. Cuối ván có danh hiệu cho từng người (Tiều phu, Bạn thân của trọng lực, Nam châm hút bẫy...).
- **Thời tiết nhìn thấy được:** mây trôi nhiều ít theo ngày, mưa rơi, bão có gió giật làm cây cỏ lắc mạnh và sấm chớp, sương mù che tầm nhìn, động đất rung từng đợt; đêm quang có đom đóm. Chạy trên cát tung bụi, bơi thì mặt nước gợn vòng.
- **Môi trường nguy hiểm:** nhảy xuống hồ dung nham trong miệng núi lửa là chết ngay (y tá cũng không cứu được); giẫm vào đống lửa trại thì bỏng từng nhịp và bị hất bật ra; lặn quá sâu mà hết hơi thì ngoi lên rất chậm và mất Máu nhanh, còn bơi khi kiệt sức hay mang balo quá nặng thì chìm dần, không đạp nước (Space) là chết đuối thật.
- **Âm thanh:** toàn bộ tổng hợp tại chỗ bằng Web Audio, không cần file: bước chân theo mặt đất (cát, cỏ, đá, nước), đánh, chém, bắn, chặt cây, cây đổ, nổ, nướng, sấm; nền sóng biển, sóng vỗ bờ, gió, mưa, dế đêm, chim ngày, lửa trại lách tách, dung nham sôi, nước nhỏ giọt trong hang; dưới nước mọi tiếng ù đi; xúc xắc, chuông khi chạm trán, nhạc hiệu đổi pha; nhạc nền tự sinh đổi theo ngày, đêm và lúc căng thẳng. Có tiếng xa gần, trái phải theo hướng camera.
- **Xã hội và suy luận:** trao tay đồ cho người bên cạnh (G); ban đêm lục soát balo một người (thấy cả ngăn bí mật, người kia biết là có người lục); khảo sát kín "bạn nghi ai" mỗi đêm; hồn ma thì thầm vào giấc mơ, làm ai đó lạnh gáy hay dẫn lối; nút ⭐ (K) đánh dấu khoảnh khắc để xem lại ở màn lật bài. Trượt mấy lần liền thì được "Quyết tâm" cộng điểm; thẻ sự kiện hợp với đồ cả đội mang theo dễ xuất hiện hơn; khung nhân vật có nhật ký được mất chỉ số.
- **Điện thoại:** cần gạt để đi, vuốt để xoay camera, nút lớn cho đánh, ném, nhảy, lặn, dùng; balo chạm-chọn rồi chạm-đặt.
- **Ban đêm:** chat quanh đống lửa, bầu khẩu phần khi thiếu, đề cử và bỏ phiếu kín để trói, và mỗi người một hành động đêm bí mật.
- **Vai ẩn:** từ 4 người có thể có một kẻ phản bội (cướp biển nằm vùng hoặc kẻ lừa đảo), có thể có y tá. Sự cố tự nhiên mỗi đêm trông giống hệt phá hoại.
- **Kết thúc:** đào kho báu ở chỗ bí mật (cần xẻng), giữ thuyền đủ tốt, rời đảo tối ngày 10; 8 kết thúc, màn lật bài và biên niên sử.
- **Kể chuyện:** không dùng mô hình AI. Bộ sinh truyện chọn cốt truyện theo seed từ thư viện 110 yếu tố viết sẵn, rồi kể bình minh, hoàng hôn, lời kể riêng từng người và biên niên sử từ sự thật trong ván.

Chưa có: bot tự chơi thay người rời ván, tự khôi phục phòng khi server khởi động lại, lưu ván xuống database.

## Chạy thử

Cần Node 22.12+ (repo có `.nvmrc` trỏ tới Node 24) và pnpm.

```sh
nvm use
pnpm install
pnpm dev
```

- Client: http://localhost:5180
- Server Colyseus: ws://localhost:2567

Mở hai tab (mỗi tab là một người chơi riêng), tab đầu bấm **Tạo phòng mới**, tab sau nhập mã phòng (hoặc dán link mời). Bạn bè cùng mạng LAN mở `http://<IP-máy-bạn>:5180`.

Chủ phòng bấm **Bắt đầu ván** khi đủ người. Ván đã bắt đầu thì không ai vào thêm được.

Điều khiển: bấm vào màn hình để khoá chuột, di chuột để xoay camera, WASD di chuyển, Shift chạy (tốn sức bền), Space nhảy (dưới nước: ngoi lên), C ngồi xuống/đứng dậy (ngồi hồi sức nhanh gấp đôi; ngồi trong đám cỏ cao là nấp: người khác không thấy tên và chấm của bạn trên bản đồ; đang bơi thì giữ C để lặn), E mở điểm sự kiện, đào kho báu, xem xét easter egg và điểm bất thường, vuốt ve sinh vật thân thiện, nhặt đồ hay trang nhật ký dưới đất, nướng hoặc góp món đang cầm vào kho khi đứng cạnh lửa trại, leo cây (đang leo: W/S lên xuống, A/D vòng quanh thân, Space nhảy ra, E buông tay) hoặc nhổ lửa trại, chuột trái đánh, chặt cây, bắn, hay ăn, trồng, đặt lửa trại tuỳ món đang cầm, giữ rồi thả chuột phải để ném (giữ càng lâu ném càng xa), Q hoặc lăn chuột để đổi món cầm, X đặt món đang cầm xuống đất, V bật chế độ dựng nhà (bấm tiếp để đổi công trình, lăn chuột để xoay, chuột trái để dựng, Esc để thôi), F kết liễu (chỉ kẻ phản bội, khi đứng sát ai đó), phím 1–4 chọn trong thẻ, B xem balo, J mở sổ truyện, H bật/tắt bảng phím tắt, G đưa món đang cầm cho người bên cạnh, K đánh dấu khoảnh khắc, M tắt/bật âm thanh, N tắt/bật nhạc nền (hoặc bấm nút loa, nút nhạc trên khung phòng), G đổi đồ họa Cao/Thấp (Thấp bỏ hậu kỳ, bớt cỏ cây, bóng đổ nhẹ hơn cho máy yếu), Enter để chat, Esc thả chuột. Lúc xếp balo: kéo thả, R hoặc chuột phải để xoay, nhấp đúp để nhấc ra khay.

Test nhanh cả ván: `PHASE_SCALE=0.1 pnpm dev` thu mỗi ngày từ 5 phút xuống còn khoảng 30 giây. Ở chế độ dev, `window.__tentides` trong console trình duyệt cho xem room, vị trí, camera và thế giới đã sinh (`world`); `__tentides.debugCam` là camera tự do (đặt `enabled`, `position`, `target`) để soi bản đồ.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `pnpm dev` | Chạy server và client cùng lúc, tự tải lại khi sửa code |
| `pnpm test` | Chạy test (Vitest) cho engine luật, nội dung và server |
| `pnpm typecheck` | Kiểm tra kiểu cho mọi package |
| `pnpm --filter @tentides/client build` | Build client tĩnh ra `apps/client/dist` |
| `pnpm --filter @tentides/server sim --games 3000 --players 4-6` | Bot chơi N ván, in phân phối kết thúc và các chỉ số cân bằng |
| `pnpm --filter @tentides/server replay logs/<file>.json --verbose` | Phát lại một ván từ file log |

Biến môi trường:

- `PORT`: cổng của server, mặc định 2567.
- `PHASE_SCALE`: co giãn thời lượng các pha, mặc định 1.
- `GAME_LOG_DIR`: thư mục ghi log ván (seed + chuỗi hành động + chat), mặc định `logs/`.
- `VITE_SERVER_URL`: địa chỉ server cho client, dùng khi server không nằm cùng máy (vd. `wss://tentides.fly.dev`).

## Cấu trúc

```
apps/
  client/     three.js + React Three Fiber + Rapier, build bằng Vite
  server/     Colyseus: phòng chơi, kiểm tra hành động của người chơi
packages/
  rules/      Engine luật thuần: vòng ngày, thẻ sự kiện, xúc xắc, PRNG có seed
  content/    Dữ liệu game kiểm tra bằng zod: đồ vật, thẻ sự kiện, bản đồ đảo
  protocol/   Hợp đồng mạng dùng chung: state đồng bộ, message, hằng số
  story/      Bộ sinh cốt truyện theo seed: không gọi AI, ghép lời kể từ thư viện yếu tố
```

Các package trỏ thẳng vào mã nguồn TypeScript (`exports: ./src/index.ts`), không cần bước build riêng.

Một số quy ước:

- Luật chơi nằm trong `reduce(state, action, config)` ở `packages/rules/src/game.ts`: hàm thuần, có tính xác định. Server chỉ đưa hành động vào, rồi chép kết quả sang state của Colyseus (`apps/server/src/sync.ts`). Dữ liệu thời gian thực (ai đang đứng ở đâu) nằm ngay trong hành động, nên seed + chuỗi hành động là đủ để phát lại cả ván.
- `rules` không phụ thuộc 3D, mạng hay AI. `simulate.test.ts` cho bot chơi 500 ván để bắt lỗi luật.
- Mọi thứ ngẫu nhiên có ảnh hưởng tới ván chơi đều đi qua PRNG trong `rules`, không dùng `Math.random()`. Chỉ mã phòng và hiệu ứng xúc xắc đang lăn trên client là dùng random thường.
- Thêm đồ, thẻ sự kiện, yếu tố truyện hay mẫu câu chỉ cần sửa `items.json`, `cards.json`, `story.json` hoặc `story_templates.json` trong `packages/content/src/data/`. Điểm sự kiện trên map nằm trong `ANCHORS` ở `island.ts`. Sinh vật, easter egg, điểm bất thường, bẫy và tên đảo, hang, hầm nằm trong `world.json`; mô hình 3D của từng loài khai báo bằng dữ liệu trong `apps/client/src/game/Wildlife.tsx`.
- Đảo chính cố định (`island.ts`); mọi thứ quanh nó do `generateWorld(seed)` trong `packages/content/src/worldgen.ts` sinh ra, hàm thuần nên client và server dựng cùng một thế giới. Client và server nên dùng `world.heightAt()` thay cho `heightAt()` của đảo chính. Seed bản đồ công khai; bẫy dùng một seed suy từ seed bí mật của ván (`generateTraps`), nên chỉ lộ khi có người sập. Sinh vật do server cho đi lại (`apps/server/src/wildlife.ts`), hơi thở và bẫy do `apps/server/src/hazards.ts` tính; khi có người bị cắn, sập bẫy, nhặt easter egg thì server đưa hành động `encounter` vào engine luật, nên log ván vẫn phát lại được. `loadContent()` sẽ báo lỗi nếu sai schema hoặc tham chiếu tới id không tồn tại.
- Âm thanh nằm trong `apps/client/src/game/sound/`: `engine.ts` (bộ máy, tiếng xa gần, trái phải, ù dưới nước), `sfx.ts` (công thức từng tiếng động), `Soundscape.tsx` (nền, bước chân, nhạc, tiếng theo sự kiện). Thêm tiếng mới chỉ cần thêm một công thức vào `RECIPES`.
- Dung nham, lửa trại và hơi thở do server tính trong `apps/server/src/hazards.ts`; chết vì dung nham là chạm trán `fatal` trong engine luật.
- Biến cố ngày 5 (`packages/rules/src/game/twists.ts`) và chuyện đêm ngủ ngoài (`data/nights.json`) nằm trong engine luật; bộ sinh truyện chỉ kể lại. Trang nhật ký có vị trí theo seed bản đồ (`world.pages`), nội dung do `diaryPage()` trong `packages/story` viết. Danh hiệu cuối ván do server tính (`apps/server/src/awards.ts`), chỉ để vui, không ảnh hưởng thắng thua.
- Cầm, đánh, ném, chặt cây, trồng cây, dựng nhà, dời trại do server quyết định (`apps/server/src/play.ts` cho phần tính toán, `playRoom.ts` cho phần nhận lệnh và đồng bộ); chỉ số của từng món nằm trong `items.json` (`melee`, `ranged`, `throw`, `chop`, `eat`, `plant`, `build`, `camp`), chỉ số chung (tay không, cây, té ngã) trong `packages/content/src/combat.ts`, công trình trong `world.json`. Thứ gì đổi balo hay chỉ số (đặt, nhặt, ăn, bị đánh, té cây, dựng nhà, kết liễu) đều đi qua engine luật như một hành động, nên log ván vẫn phát lại được. Người bị kết liễu chỉ hiện là "gục ngã"; ai ra tay chỉ lộ ở màn lật bài.
- Client tự tính di chuyển (Rapier) rồi báo vị trí lên server. Server không chạy vật lý, nhưng kéo người chơi về chỗ cũ nếu vị trí vượt tốc độ chạy, ra ngoài map hoặc chui xuống đất (`apps/server/src/movement.ts`).
- Thông tin riêng (vai, hành động đêm, ghi chú, balo đầy đủ, lời kể riêng) không nằm trong state chung: server tính `privateView` cho từng người và chỉ gửi cho đúng người đó. Trong state chung, `items` chỉ gồm đồ ngoài ngăn bí mật.
- Chat không nằm trong state: server chỉ gửi tin cho đúng người được nghe (`chatAudience` trong `IslandRoom.ts`) và giữ biên bản từng đêm để sau này AI dùng làm dữ liệu kể chuyện.
- State trong `protocol` chỉ chứa thứ công khai (có cả seed bản đồ; seed của engine luật thì không bao giờ gửi xuống client, vì từ nó suy ra được vai ẩn và chỗ kho báu). Phiếu trói là phiếu kín: engine giữ phiếu thật, state chỉ công khai ai đã bầu cho tới khi lật. Vai của mọi người và hành động từng đêm chỉ được chép vào state khi ván kết thúc (màn lật bài).
