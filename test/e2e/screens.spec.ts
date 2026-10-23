// 로그인 뒤 각 화면을 데스크톱·375px에서 열어 스크린샷과 가로 스크롤 검사(4.6-3), 의견 보내기 링크(4.6-9), 접근 가능한 이름(4.10-9)을 본다.
import { expect, test } from "@playwright/test";
import { HANA_1, file } from "./files";
import { expectAccessibleNames, expectFeedbackLink, expectNoHorizontalScroll, loginAs, open, shot } from "./helpers";

const SCREENS = [
  ["home", "/home"],
  ["monthly", "/monthly"],
  ["transactions", "/transactions?month=all"],
  ["upload", "/upload"],
  ["accounts", "/accounts"],
  ["categories", "/categories"],
  ["settings", "/settings"],
  ["admin", "/admin"],
  ["privacy", "/privacy"],
] as const;

test("로그인 뒤 모든 화면", async ({ page }, info) => {
  await loginAs(page, "admin");
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(HANA_1));
  const create = page.getByRole("button", { name: "계정 만들고 올리기" });
  const applied = page.locator("main").getByText(/^반영함/);
  await expect(create.or(applied).first()).toBeVisible();
  if (await create.isVisible()) await create.click();
  await expect(applied).toBeVisible();

  for (const [name, url] of SCREENS) {
    await open(page, url);
    await expect(page.locator("main, article").first()).not.toBeEmpty();
    if (url !== "/privacy") await expectFeedbackLink(page);
    await expectNoHorizontalScroll(page);
    await expectAccessibleNames(page);
    await shot(page, info, `app-${name}`);
  }

  if (info.project.name === "mobile") {
    // 사이드바는 접히는 메뉴가 된다
    await open(page, "/home");
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.getByRole("link", { name: "거래 목록" })).toBeVisible();
    await shot(page, info, "app-menu-open");
  }
});
