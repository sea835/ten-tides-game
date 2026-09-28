# TEN TIDES

Game co-op 3D sống sót 10 ngày trên đảo, chạy trên trình duyệt. Mô tả thiết kế đầy đủ ở [PROJECT.md](PROJECT.md).

Hiện tại: **graybox giai đoạn 1**. Đảo 4 vùng dựng bằng khối, nhiều người vào chung phòng bằng mã 4 ký tự, di chuyển góc nhìn thứ ba và thấy nhau theo thời gian thực.

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

Điều khiển: bấm vào màn hình để khoá chuột, di chuột để xoay camera, WASD di chuyển, Shift chạy, Space nhảy, Esc thả chuột.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `pnpm dev` | Chạy server và client cùng lúc, tự tải lại khi sửa code |
| `pnpm test` | Chạy test (Vitest) cho engine luật, nội dung và server |
| `pnpm typecheck` | Kiểm tra kiểu cho mọi package |
| `pnpm --filter @tentides/client build` | Build client tĩnh ra `apps/client/dist` |

Biến môi trường: `PORT` cho server (mặc định 2567), `VITE_SERVER_URL` cho client khi server không nằm cùng máy (vd. `wss://tentides.fly.dev`).

## Cấu trúc

```
apps/
  client/     three.js + React Three Fiber + Rapier, build bằng Vite
  server/     Colyseus: phòng chơi, kiểm tra hành động của người chơi
packages/
  rules/      Engine luật thuần: PRNG có seed, tung xúc xắc kèm các khoản cộng
  content/    Dữ liệu game kiểm tra bằng zod: đồ vật, thẻ sự kiện, bản đồ đảo
  protocol/   Hợp đồng mạng dùng chung: state đồng bộ, message, hằng số
```

Các package trỏ thẳng vào mã nguồn TypeScript (`exports: ./src/index.ts`), không cần bước build riêng.

Một số quy ước:

- `rules` không phụ thuộc 3D, mạng hay AI, để có thể chạy mô phỏng hàng loạt ván bằng bot.
- Mọi thứ ngẫu nhiên đi qua PRNG trong `rules`, không dùng `Math.random()`. Ngoại lệ duy nhất là mã phòng.
- Thêm đồ hoặc thẻ sự kiện mới chỉ cần thêm JSON trong `packages/content/src/data/`. `loadContent()` sẽ báo lỗi nếu sai schema hoặc tham chiếu tới id không tồn tại.
- Client tự tính di chuyển (Rapier) rồi báo vị trí lên server. Server không chạy vật lý, nhưng kéo người chơi về chỗ cũ nếu vị trí vượt tốc độ chạy, ra ngoài map hoặc chui xuống đất (`apps/server/src/movement.ts`).
- State trong `protocol` chỉ chứa thứ công khai. Bí mật như vai ẩn hay ngăn bí mật sẽ gắn `.view()` và chỉ gửi cho đúng người qua `StateView`.
