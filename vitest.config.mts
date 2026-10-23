import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // DB를 쓰는 테스트는 파일마다 처음 한 번 프로세스 안 Postgres(PGlite)에 마이그레이션을 적용한다.
    // CI 러너에서는 이것만으로 기본 5초를 넘을 수 있어 넉넉히 둔다.
    testTimeout: 30_000,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // 서버 시간대(UTC)와 상관없이 한국 시간으로 계산하는지 보기 위해 UTC로 돌린다(4.2-3).
    // 계좌 해시 키는 테스트용 값이다. 분류 한도는 기본값으로 두고, 한도 테스트가 작은 값으로 바꾼다.
    env: { TZ: "UTC", ACCOUNT_HASH_KEY: "test-account-hash-key" },
  },
});
