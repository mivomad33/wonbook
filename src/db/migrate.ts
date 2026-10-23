// 마이그레이션 적용(pnpm db:migrate, 개발 DB 초기화, 테스트 DB 준비). 이미 적용한 것은 건너뛴다.
// 풀링하지 않는 연결 주소를 받는다(마이그레이션은 세션 단위 잠금을 쓴다).
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDb } from "./client";

export async function migrateDb(url: string): Promise<void> {
  const { db, pool } = openDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}
