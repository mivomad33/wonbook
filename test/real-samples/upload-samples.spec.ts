// 실제 샘플 8개를 브라우저에서 읽어 올린다(4.3-1, 4.3-3). samples/가 없으면 건너뛴다.
// - 서버로 간 요청에 원본 파일 내용과 내 계좌 식별값이 없다. 요청 하나는 4.5MB보다 작다.
// - 브라우저에서 읽은 결과가 Node에서 같은 파서로 읽은 결과와 같다(가리기·해시 전 값).
// - 맞는 계정이 없으면 "계정 만들고 올리기"로 모두 반영된다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const SAMPLES = path.join(process.cwd(), "samples");
const SHOTS = path.join(process.cwd(), "docs/specs/2026-10-public-multiuser/evidence");
const files = fs.existsSync(SAMPLES) ? fs.readdirSync(SAMPLES).filter((f) => /\.(xls|xlsx)$/i.test(f)).map((f) => path.join(SAMPLES, f)) : [];

test.skip(files.length === 0, "samples/가 없습니다");

test("실제 샘플을 브라우저에서 읽어 올린다", async ({ page }) => {
  expect(files).toHaveLength(8);
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") bodies.push(r.postData() ?? "");
  });

  await page.goto("/api/auth/dev-login?as=user2", { waitUntil: "domcontentloaded" });
  await page.goto("/upload", { waitUntil: "domcontentloaded" });
  // 개발 서버는 첫 연결 때 한 번 다시 읽을 수 있어, 잠시 기다린 뒤 하이드레이션을 확인한다.
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => Boolean((window as unknown as { next?: { router?: unknown } }).next?.router));
  await page.getByTestId("upload-input").setInputFiles(files);
  const rows = page.locator("section:has(h2:text('이번 결과')) tbody tr");
  await expect(rows).toHaveCount(8);
  // 맞는 계정이 없는 파일은 계정을 만들어 올린다.
  for (let i = 0; i < 8; i++) {
    const create = page.getByRole("button", { name: "계정 만들고 올리기" }).first();
    if (!(await create.isVisible().catch(() => false))) break;
    await create.click();
    await expect(page.getByRole("button", { name: "계정 만들고 올리기" })).toHaveCount(Math.max(0, 7 - i), { timeout: 120_000 });
  }
  await expect(rows.filter({ hasText: "반영함" })).toHaveCount(8);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "samples-upload-desktop.png"), fullPage: true });

  // 서버로 간 요청 검사
  const expected = JSON.parse(execFileSync("pnpm", ["exec", "tsx", "test/real-samples/expected.ts", SAMPLES], { encoding: "utf8", maxBuffer: 1 << 28 })) as {
    ids: string[];
    parsed: { name: string; parsed: unknown }[];
  };
  const ids = expected.ids;
  expect(ids.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(new TextEncoder().encode(body).length).toBeLessThan(4.5 * 1024 * 1024);
    expect(body).not.toContain("PK\u0003\u0004");
    expect(body.includes("ÐÏ\u0011à")).toBe(false);
    const flat = body.replace(/[-\s]/g, "");
    for (const id of ids) expect(flat.includes(id)).toBe(false);
  }

  // 브라우저에서 읽은 결과와 Node에서 읽은 결과 비교(가리기·해시 전)
  const browser = (await page.evaluate(() => (window as unknown as { __wonbookParsed?: unknown[] }).__wonbookParsed ?? [])) as { name: string; parsed: unknown }[];
  expect(browser.length).toBeGreaterThanOrEqual(8);
  for (const file of files) {
    const fromBrowser = browser.find((b) => b.name === path.basename(file));
    expect(fromBrowser, path.basename(file)).toBeTruthy();
    const fromNode = expected.parsed.find((p) => p.name === path.basename(file));
    expect(JSON.parse(JSON.stringify(fromBrowser!.parsed))).toEqual(fromNode!.parsed);
  }
});
