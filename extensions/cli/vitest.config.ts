import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.global-dir-setup.ts", "./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.e2e.*", "**/e2e/**"],
    coverage: {
      reporter: ["text", "json", "html"],
      // Keep a small, enforceable floor on security-sensitive CLI boundaries
      // rather than allowing coverage to silently regress as the codebase
      // grows. Broader package coverage remains available on demand.
      include: [
        "src/permissions/defaultPolicies.ts",
        "src/permissions/precedenceResolver.ts",
        "src/services/BackgroundJobService.ts",
        "src/services/MCPService.ts",
        "src/commands/serveAuth.ts",
        "src/commands/serveOptions.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 40,
        functions: 30,
        branches: 25,
        statements: 40,
      },
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/test-helpers/**",
        "**/types/**",
        "**/__mocks__/**",
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, "src"),
    },
    extensions: [".js", ".ts", ".tsx", ".json"],
  },
});
