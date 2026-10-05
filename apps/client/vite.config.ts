import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true để bạn bè cùng mạng LAN mở được bằng IP của máy.
  server: { host: true, port: 5180, strictPort: true },
  // Bản build (pnpm play) mở ở cùng địa chỉ với bản dev.
  preview: { host: true, port: 5180, strictPort: true },
  build: {
    target: "es2022",
    // Gộp phần font tiếng Việt vào CSS để không thành request riêng từng file.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Tách thư viện nặng ra khỏi mã game, để sảnh chờ chỉ tải React, three và mã sảnh; vật lý (Rapier), hậu kỳ
        // (postprocessing, N8AO) chỉ tải cùng màn chơi (Game nạp lười trong App.tsx). Vite 8 dùng rolldown: nhóm có
        // `priority` cao bắt module trước. Trước đây dùng `manualChunks` dạng hàm: rolldown kéo luôn các module mà
        // nhóm phụ thuộc vào (three bị nhét vào chunk "post", React cũng vậy), nên sảnh chờ vẫn tải cả 3,5 MB.
        codeSplitting: {
          groups: [
            // Hàm nạp trước (modulepreload) của Vite cho các import động: để mặc thì nằm trong chunk Rapier, sảnh chờ
            // gọi tới là tải luôn 2 MB vật lý.
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]|vite[\\/]preload-helper/, priority: 50 },
            { name: "three", test: /node_modules[\\/](three|@react-three[\\/]fiber|its-fine|zustand|suspend-react)[\\/]/, priority: 40 },
            { name: "rapier", test: /node_modules[\\/](@dimforge[\\/]rapier3d[^\\/]*|@react-three[\\/]rapier)[\\/]/, priority: 30 },
            { name: "post", test: /node_modules[\\/](postprocessing|n8ao|maath|@react-three[\\/]postprocessing)[\\/]/, priority: 20 },
            { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
          ],
        },
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
