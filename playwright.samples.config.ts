// 실제 샘플 확인(4.3-1, 4.3-3). 개발 DB를 쓰는 개발 서버(pnpm dev, 3000)에 실제 샘플(samples/)을 올린다.
// 실제 샘플은 개발 DB에만 올린다(4.8-2). 스크린샷은 저장소 밖(명세서 폴더)에 둔다(4.9-2).
// 사용: pnpm dev를 띄운 뒤 pnpm exec playwright test -c playwright.samples.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/real-samples",
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 120_000 },
  reporter: [["list"]],
  outputDir: "test-results/samples",
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
});
