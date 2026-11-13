import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./*" path mapping so route modules
    // under app/api/** (which import via the "@/..." alias) can be
    // imported directly from spec files without vite failing to resolve
    // the bare alias. Mirrors apps/web/vitest.config.ts's identical setup.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.spec.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
