// 개발 DB를 비우고 시드로 다시 채운다(4.8-2). 사용: pnpm db:dev-reset [--test]
// 스키마를 지우고 마이그레이션을 처음부터 적용한 뒤, 테스트 사용자 둘을 만들고 user1에 시드 데이터를 넣는다.
// 운영 DB(--prod)에는 쓰지 않는다. 운영 데이터를 복사하지도 않는다. 개발 서버가 켜져 있으면 다시 켠다(연결이 끊긴다).
import "./env";
import { openDb } from "@/db/client";
import { createDefaultCategories } from "@/db/default-categories";
import { users } from "@/db/schema";
import { seed } from "@/db/seed";
import { resetSchema } from "./lib/reset-schema";
import { target } from "./lib/target";

const TEST_USERS = ["user1", "user2"] as const;

async function main() {
  if (process.argv.includes("--prod")) throw new Error("운영 DB는 초기화하지 않습니다(개발 DB 또는 --test만)");
  const t = target();
  await resetSchema(t.url);
  const { db, pool } = openDb(t.url, 1);
  try {
    const ids: Record<string, number> = {};
    for (const u of TEST_USERS) {
      const [row] = await db.insert(users).values({ email: `${u}@test.local`, name: `테스트 ${u}` }).returning({ id: users.id });
      await createDefaultCategories(db, row.id);
      ids[u] = row.id;
    }
    await seed(db, ids.user1);
  } finally {
    await pool.end();
  }
  console.log(`${t.name} DB를 비우고 시드로 채웠습니다(사용자 ${TEST_USERS.join(", ")}, 시드 데이터는 user1).`);
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
