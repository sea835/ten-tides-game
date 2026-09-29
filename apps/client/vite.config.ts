import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true để bạn bè cùng mạng LAN mở được bằng IP của máy.
  server: { host: true, port: 5180, strictPort: true },
  // Bản build (pnpm play) mở ở cùng địa chỉ với bản dev.
  preview: { host: true, port: 5180, strictPort: true },
});
