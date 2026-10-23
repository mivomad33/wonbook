import { defineConfig } from "vitest/config";

// 통합 테스트(4.10-1): 서버 동작과 DB를 함께, 실제 Postgres(Neon test 브랜치)에서 돌린다.
// 사용: pnpm test:integration (test/setup-db.ts가 test 브랜치 스키마를 다시 만들고 주소를 넘긴다)
// 비밀 키는 테스트용 값이다. Claude API는 가짜로 바꿔 끼운다(setup.ts).
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL이 없습니다. pnpm test:integration으로 실행하세요.");

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["test/integration/setup.ts"],
    // 한 DB를 같이 쓰므로 파일을 차례로 돌린다. 파일 안의 동시 요청 테스트는 실제로 동시에 보낸다.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      TZ: "UTC",
      DATABASE_URL: url,
      ACCOUNT_HASH_KEY: "test-account-hash-key",
      PASSWORD_ENCRYPTION_KEY: "test-password-encryption-key",
      ADMIN_EMAIL: "admin@test.local",
      ANTHROPIC_API_KEY: "",
    },
  },
});
