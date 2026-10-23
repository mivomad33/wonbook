// 개발 전용: 개발 DB의 테스트 사용자에게 .env.local의 KAKAOBANK_FILE_PASSWORD를 저장된 카카오뱅크 암호로 넣는다(4.3-1).
// 실제 샘플 확인 때 실제 파일 암호를 화면에 치지 않기 위해서다. 값은 출력하지 않는다. 운영 DB에는 쓰지 않는다.
// 사용: pnpm exec tsx scripts/dev-kakao-password.ts [user2]
import "./env";
import { eq } from "drizzle-orm";
import { openDb } from "@/db/client";
import { users } from "@/db/schema";
import { saveKakaoPassword } from "@/secrets/kakao-password";
import { target } from "./lib/target";

async function main() {
  const t = target();
  if (t.key !== "dev") throw new Error("개발 DB에만 씁니다");
  const password = process.env.KAKAOBANK_FILE_PASSWORD;
  if (!password) throw new Error("KAKAOBANK_FILE_PASSWORD가 없습니다");
  const email = `${process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "user2"}@test.local`;
  const { db, pool } = openDb(t.url, 1);
  try {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u) throw new Error(`${email} 사용자가 없습니다(개발 서버에서 테스트 로그인으로 먼저 만듭니다)`);
    await saveKakaoPassword(db, u.id, password);
    console.log(`${email}에 카카오뱅크 암호를 저장했습니다.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
