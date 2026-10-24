// 원격 DB를 암호화한 파일로 백업한다(4.8-4). 사용: pnpm db:backup [--prod | --test] [저장할 폴더]
// 기본 대상은 개발 DB다. 운영 DB는 --prod를 줘야 한다.
// 복원: pnpm -s exec tsx scripts/backup-decrypt.ts <파일> | pg_restore --no-owner --no-privileges -d "<주소>" (DEVELOPMENT.md "백업과 복원")
import "./env";
import { BACKUP_DIR, backupDb } from "./lib/backup";
import { target } from "./lib/target";

async function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) || BACKUP_DIR;
  const t = target();
  console.log(`백업: ${t.name} DB → ${await backupDb(t, dir)}`);
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
