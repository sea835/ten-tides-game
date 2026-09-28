# TEN TIDES

Game co-op 3D sống sót 10 ngày trên đảo, chạy trên trình duyệt. Mô tả thiết kế đầy đủ ở [PROJECT.md](PROJECT.md).

Hiện tại: **graybox giai đoạn 1**.

- Đảo có 4 vùng dựng bằng khối. Nhiều người vào chung phòng bằng mã 4 ký tự, di chuyển góc nhìn thứ ba và thấy nhau theo thời gian thực.
- Vòng 10 ngày chạy đủ: bình minh, khám phá có đồng hồ mặt trời, hoàng hôn, đêm.
- Đêm quanh đống lửa: chat, bỏ phiếu chia khẩu phần, bỏ phiếu trói người bị nghi. Người ngủ ngoài không nghe được cả trại bàn gì và không được ăn.
- Mỗi sáng, 12 thẻ sự kiện được xếp vào các điểm trên map. Tới cột sáng nhấn E để mở thẻ; xúc xắc hiện công khai kèm các khoản cộng.

Chưa có: tạo nhân vật (thuộc tính được chia ngẫu nhiên), balo 16x16 (mỗi người được phát tạm 3 món), AI kể chuyện (đang dùng lời văn mẫu gắn theo thẻ), sự kiện đêm riêng cho người ngủ ngoài, thuyền, đào kho báu, vai ẩn.

## Chạy thử

Cần Node 22.12+ (repo có `.nvmrc` trỏ tới Node 24) và pnpm.

```sh
nvm use
pnpm install
pnpm dev
```

- Client: http://localhost:5180
- Server Colyseus: ws://localhost:2567

Mở hai tab, tab đầu bấm **Tạo phòng mới**, tab sau nhập mã phòng (hoặc dán link mời). Bạn bè cùng mạng LAN mở `http://<IP-máy-bạn>:5180`.

Chủ phòng bấm **Bắt đầu ván** khi đủ người. Ván đã bắt đầu thì không ai vào thêm được.

Điều khiển: bấm vào màn hình để khoá chuột, di chuột để xoay camera, WASD di chuyển, Shift chạy, Space nhảy, E mở điểm sự kiện, phím 1–4 chọn trong thẻ, Enter để chat (ở sảnh chờ và ban đêm), Esc thả chuột.

Test nhanh cả ván: `PHASE_SCALE=0.1 pnpm dev` thu mỗi ngày từ 5 phút xuống còn khoảng 30 giây. Ở chế độ dev, `window.__tentides` trong console trình duyệt cho xem room, vị trí và camera.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `pnpm dev` | Chạy server và client cùng lúc, tự tải lại khi sửa code |
| `pnpm test` | Chạy test (Vitest) cho engine luật, nội dung và server |
| `pnpm typecheck` | Kiểm tra kiểu cho mọi package |
| `pnpm --filter @tentides/client build` | Build client tĩnh ra `apps/client/dist` |

Biến môi trường:

- `PORT`: cổng của server, mặc định 2567.
- `PHASE_SCALE`: co giãn thời lượng các pha, mặc định 1.
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
```

Các package trỏ thẳng vào mã nguồn TypeScript (`exports: ./src/index.ts`), không cần bước build riêng.

Một số quy ước:

- Luật chơi nằm trong `reduce(state, action, config)` ở `packages/rules/src/game.ts`: hàm thuần, có tính xác định. Server chỉ đưa hành động vào, rồi chép kết quả sang state của Colyseus (`apps/server/src/sync.ts`). Dữ liệu thời gian thực (ai đang đứng ở đâu) nằm ngay trong hành động, nên seed + chuỗi hành động là đủ để phát lại cả ván.
- `rules` không phụ thuộc 3D, mạng hay AI. `simulate.test.ts` cho bot chơi 500 ván để bắt lỗi luật.
- Mọi thứ ngẫu nhiên có ảnh hưởng tới ván chơi đều đi qua PRNG trong `rules`, không dùng `Math.random()`. Chỉ mã phòng và hiệu ứng xúc xắc đang lăn trên client là dùng random thường.
- Thêm đồ hoặc thẻ sự kiện mới chỉ cần sửa `items.json` hoặc `cards.json` trong `packages/content/src/data/`. Điểm sự kiện trên map nằm trong `ANCHORS` ở `island.ts`. `loadContent()` sẽ báo lỗi nếu sai schema hoặc tham chiếu tới id không tồn tại.
- Client tự tính di chuyển (Rapier) rồi báo vị trí lên server. Server không chạy vật lý, nhưng kéo người chơi về chỗ cũ nếu vị trí vượt tốc độ chạy, ra ngoài map hoặc chui xuống đất (`apps/server/src/movement.ts`).
- Chat không nằm trong state: server chỉ gửi tin cho đúng người được nghe (`chatAudience` trong `IslandRoom.ts`) và giữ biên bản từng đêm để sau này AI dùng làm dữ liệu kể chuyện.
- State trong `protocol` chỉ chứa thứ công khai. Bí mật như vai ẩn hay ngăn bí mật sẽ gắn `.view()` và chỉ gửi cho đúng người qua `StateView`. Phiếu bầu ban đêm hiện vẫn nằm trong state công khai (giao diện chỉ hiện cho người trong trại); sẽ chuyển sang `StateView` cùng lúc với vai ẩn.
