// 소개 화면 → 데모 둘러보기(4.5-1, 4.5-3, 4.5-4, 4.6-1, 4.6-3, 4.6-9)
import { expect, test } from "@playwright/test";
import { expectAccessibleNames, expectFeedbackLink, expectNoHorizontalScroll, open, ready, shot } from "./helpers";

const DEMO_SCREENS = [
  ["home", "/home"],
  ["monthly", "/monthly"],
  ["transactions", "/transactions"],
  ["categories", "/categories"],
  ["accounts", "/accounts"],
  ["upload", "/upload"],
] as const;

test("소개 화면에서 데모로 들어가 모든 화면을 본다", async ({ page }, info) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^은행 파일만 올리면\s*가계부 정리 끝$/);
  await expectFeedbackLink(page);
  await expectNoHorizontalScroll(page);
  await expectAccessibleNames(page);
  await shot(page, info, "landing");

  await page.getByRole("link", { name: "로그인 없이 데모 보기" }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  await ready(page);

  for (const [name, url] of DEMO_SCREENS) {
    if (!page.url().endsWith(url)) await open(page, url);
    const banner = page.getByRole("status").filter({ hasText: "가짜 데이터로 둘러보는 중입니다" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "구글로 로그인" })).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
    await expectFeedbackLink(page);
    await expectNoHorizontalScroll(page);
    await expectAccessibleNames(page);
    await shot(page, info, `demo-${name}`);
  }
});

test("데모의 쓰기 버튼은 로그인 안내를 띄운다", async ({ page }) => {
  await open(page, "/demo");
  const prompt = page.getByRole("dialog").filter({ hasText: "로그인하면 할 수 있습니다." });
  const tryButton = async (url: string, name: string) => {
    await open(page, url);
    await page.getByRole("button", { name }).first().click();
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole("link", { name: "구글로 로그인" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
  };
  await tryButton("/accounts", "계정 추가");
  await tryButton("/categories", "카테고리 추가");
  await tryButton("/transactions?month=all", "거래 추가");
  await tryButton("/upload", "금융사 파일 고르기");
  await tryButton("/upload", "되돌리기");

  // 카테고리 바꾸기(목록의 배지)도 안내만 띄운다
  await open(page, "/transactions?month=all");
  const select = page.getByRole("combobox", { name: "카테고리 바꾸기" }).first();
  const before = await select.inputValue();
  const other = await select.locator("option").evaluateAll((os, cur) => (os as HTMLOptionElement[]).find((o) => o.value && o.value !== cur)!.value, before);
  await select.selectOption(other);
  await expect(prompt).toBeVisible();
  await page.keyboard.press("Escape");
  await open(page, "/transactions?month=all");
  await expect(page.getByRole("combobox", { name: "카테고리 바꾸기" }).first()).toHaveValue(before);

  // 설정은 데모에 없다(자산 현황으로 간다). CSV 내보내기는 403
  await open(page, "/settings");
  await expect(page).toHaveURL(/\/home$/);
  expect((await page.request.get("/api/export")).status()).toBe(403);
});
