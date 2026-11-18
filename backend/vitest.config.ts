import { defineConfig } from "vitest/config";

// Unit tests: no network, no Docker. Integration tests have their own config (vitest.integration.config.ts).
export default defineConfig({ test: { include: ["tests/unit/**/*.test.ts"] } });
