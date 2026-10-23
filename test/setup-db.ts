// 통합·E2E 테스트용 DB를 준비하고 접속 주소를 표준 출력으로 내보낸다. 사용: TEST_DATABASE_URL=$(tsx test/setup-db.ts)
// Neon의 테스트 전용 브랜치(test, NEON_TEST_BRANCH_ID)를 쓴다. 운영·개발 브랜치는 건드리지 않는다.
// 스키마를 지우고 마이그레이션을 처음부터 적용해, 지난 실행의 데이터와 스키마가 남지 않게 한다(4.8-2).
// 운영 사본으로 되돌리거나 운영에서 다시 분기하지 않는다(실제 금융 데이터가 복사되기 때문이다).
import "../scripts/env";
import { connectionUri } from "../scripts/lib/neon";
import { resetSchema } from "../scripts/lib/reset-schema";

async function main() {
  const testId = process.env.NEON_TEST_BRANCH_ID;
  if (!testId) throw new Error("NEON_TEST_BRANCH_ID가 없습니다");
  if ([process.env.NEON_PROD_BRANCH_ID, process.env.NEON_DEV_BRANCH_ID].includes(testId)) throw new Error("테스트 브랜치가 운영·개발 브랜치와 같습니다");
  const url = await connectionUri(testId);
  await resetSchema(url);
  process.stdout.write(url);
}

main().catch((e) => {
  console.error(`테스트 DB 준비 실패: ${(e as Error).message}`);
  process.exit(1);
});
