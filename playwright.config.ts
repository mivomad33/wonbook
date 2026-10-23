// E2E(4.10-1): 핵심 흐름을 데스크톱과 375px에서 돈다. 사용: pnpm test:e2e
// 개발 서버(next dev, 테스트 로그인 켜짐)를 Neon test 브랜치(E2E_DATABASE_URL)로 따로 띄운다. 개발 DB(dev)는 쓰지 않는다.
// 분류는 가짜(WONBOOK_FAKE_CLASSIFIER)이고, 관리자는 테스트 이메일이다. 통합 테스트와 같은 브랜치라 동시에 돌리지 않는다.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const db = process.env.E2E_DATABASE_URL;
if (!db) throw new Error("E2E_DATABASE_URL이 없습니다. pnpm test:e2e로 실행하세요.");

export default defineConfig({
  testDir: "test/e2e",
  globalSetup: "test/e2e/global-setup.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next dev -H 127.0.0.1 -p ${PORT}`,
    url: `http://localhost:${PORT}/privacy`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: db,
      NEXT_DIST_DIR: ".next-e2e",
      WONBOOK_FAKE_CLASSIFIER: "1",
      ANTHROPIC_API_KEY: "",
      ADMIN_EMAIL: "admin@test.local",
    },
  },
});
