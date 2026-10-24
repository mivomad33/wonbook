// 마이그레이션을 원격 DB에 적용한다. 사용: pnpm db:migrate [--prod | --test]
// 기본 대상은 개발 DB다. 운영 DB(--prod)는 적용 전에 자동으로 암호화 백업한다(4.10-7).
// 0002(카테고리 색·아이콘)를 이번 실행에서 새로 적용했으면 개수를 확인해 출력한다(design-refresh 명세서 4.9-2).
import "./env";
import { openDb } from "@/db/client";
import { countCategoryStyles, dbNow, hasCategoryStyleColumns } from "@/db/category-style-check";
import { migrateDb } from "@/db/migrate";
import { backupBeforeChange, target } from "./lib/target";

async function main() {
  const t = target();
  await backupBeforeChange(t);
  const { db, pool } = openDb(t.url, 1);
  try {
    const startedAt = await dbNow(db);
    const hadStyle = await hasCategoryStyleColumns(db);
    await migrateDb(t.url);
    console.log(`마이그레이션 적용: ${t.name} DB`);
    const { total, mismatched } = await countCategoryStyles(db, startedAt);
    if (hadStyle) {
      // 이미 적용된 뒤의 실행: 사용자가 색을 바꿨을 수 있어 참고 값이다.
      console.log(`카테고리 색·아이콘(참고): 카테고리 ${total}개, 처음 카테고리 이름인데 기본값이 아닌 것 ${mismatched}개`);
    } else {
      console.log(`카테고리 색·아이콘 채우기 확인: 카테고리 ${total}개, 처음 카테고리 이름인데 기본값이 아닌 것 ${mismatched}개`);
      if (mismatched > 0) throw new Error("처음 카테고리 이름인데 기본 색·아이콘이 아닌 카테고리가 있습니다");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
