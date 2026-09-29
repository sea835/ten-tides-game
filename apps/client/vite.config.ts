import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true để bạn bè cùng mạng LAN mở được bằng IP của máy.
  server: { host: true, port: 5180, strictPort: true },
  build: {
    target: "es2022",
    // Gộp phần font tiếng Việt vào CSS để không thành request riêng từng file.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Tách thư viện nặng ra khỏi mã game. Trước đây không có `manualChunks` nên toàn bộ
        // client (kể cả cả chế độ Battleground mà người chơi chế độ cốt truyện không dùng)
        // nằm trong một chunk. Tách riêng cũng giúp trình duyệt cache lại được phần không đổi.
        // Vite 8 dùng rolldown nên `manualChunks` ở dạng hàm (dạng object là của rollup thuần).
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/rapier3d|@react-three\/rapier/.test(id)) return "rapier";
          if (/@react-three\/postprocessing|postprocessing|n8ao|maath/.test(id)) return "post";
          if (/node_modules\/(three|@react-three)\//.test(id)) return "three";
          return "vendor";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
