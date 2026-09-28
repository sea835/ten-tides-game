import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts"],
    // Các bài mô phỏng hàng trăm ván chạy song song với nhau, máy chậm dễ quá mặc định 5 giây.
    testTimeout: 30_000,
  },
});
