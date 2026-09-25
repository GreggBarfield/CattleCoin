import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/**/*.d.ts",
        "src/App.tsx",
        "src/components/ui/**",
        "src/lib/types.ts",
        "src/pages/Admin.tsx",
        "src/pages/Rancher.tsx",
        "src/pages/InvestPage.tsx",
        "src/pages/PoolDetail.tsx",
        "src/pages/CowDetail.tsx",
        "src/pages/InvestorDashboard.tsx",
        "src/components/tables/**",
      ],
    },
  },
});