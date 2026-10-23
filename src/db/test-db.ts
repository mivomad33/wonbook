import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";
import { users } from "./schema";
import { createDefaultCategories } from "./default-categories";

// 테스트마다 프로세스 안의 Postgres(PGlite)를 새로 쓰고 실제 마이그레이션을 적용한다(design.md 4.2).
// 외부 DB 없이 돌아 CI에서도 쓴다. 동시 요청처럼 실제 서버가 필요한 확인은 통합 테스트(Neon test 브랜치)가 맡는다.
// 마이그레이션은 파일마다 한 번만 적용하고, 테스트마다 그 DB를 복제해 빠르게 새 DB를 얻는다.
let template: Promise<PGlite> | undefined;

async function migratedTemplate(): Promise<PGlite> {
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return client;
}

export async function createTestDb(): Promise<Db> {
  template ??= migratedTemplate();
  const client = (await (await template).clone()) as PGlite;
  return drizzle(client, { schema }) as unknown as Db;
}

// 테스트용 사용자를 만들고 기본 카테고리를 넣는다(가입과 같다, 4.1-1).
export async function createTestUser(db: Db, email = `user${Math.random().toString(36).slice(2, 8)}@test.local`): Promise<number> {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  await createDefaultCategories(db, u.id);
  return u.id;
}

// 사용자 하나가 있는 테스트 DB. 대부분의 테스트는 이것으로 충분하다.
export async function createTestContext(): Promise<{ db: Db; userId: number }> {
  const db = await createTestDb();
  const userId = await createTestUser(db);
  return { db, userId };
}
