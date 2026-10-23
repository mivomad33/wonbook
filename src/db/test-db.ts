import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./client";

// 테스트마다 새 메모리 DB를 만들고 실제 마이그레이션을 적용한다(design.md 4.2).
export function createTestDb() {
  const db = createDb(":memory:");
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}
