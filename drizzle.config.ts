import { defineConfig } from "drizzle-kit";

// 마이그레이션 파일만 만든다(`pnpm db:generate`). 적용은 scripts/migrate.ts가 한다(기본 개발 DB, --prod면 운영, 4.8-2).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
