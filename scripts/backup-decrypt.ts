// 암호화한 백업을 풀어 표준 출력으로 내보낸다. 평문 파일은 만들지 않는다. 사용:
//   pnpm -s exec tsx scripts/backup-decrypt.ts <파일> | pg_restore -l
//   pnpm -s exec tsx scripts/backup-decrypt.ts <파일> | pg_restore --no-owner --no-privileges -d "<주소>"
// 인증 태그를 확인한 뒤에만 내보낸다. 키가 틀리거나 파일이 손상됐으면 아무것도 내보내지 않고 1로 끝난다.
import "./env";
import { backupKey, decryptFile } from "./lib/backup";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("백업 파일 경로를 줍니다: tsx scripts/backup-decrypt.ts <파일>");
  if (process.stdout.isTTY) throw new Error("평문 덤프를 화면에 내보내지 않습니다. pg_restore로 파이프합니다.");
  const plain = await decryptFile(file, backupKey());
  await new Promise<void>((resolve, reject) => process.stdout.write(plain, (e) => (e ? reject(e) : resolve())));
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
