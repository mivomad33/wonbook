// 화면 디자인 개편(design-refresh 명세서 4.3~4.5, 4.8): 월별 추이·구성 이동, 거래 목록 날짜 머리줄, 800px 폭,
// 카테고리 색·아이콘 고치기(키보드), 데이터 없는 사용자. 데모는 6개월 시드라 추이·머리줄 확인에 쓴다.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { HANA_1, file } from "./files";
import { expectAccessibleNames, expectNoHorizontalScroll, loginAs, open, shot } from "./helpers";

const byProject = (info: TestInfo, desktop: string, mobile: string) => (info.project.name === "mobile" ? mobile : desktop);

async function openDemo(page: Page, url: string) {
  await open(page, "/demo");
  await expect(page).toHaveURL(/\/home$/);
  await open(page, url);
}

test("월별: 추이 막대를 누르면 그 달로, 카테고리 줄을 누르면 그 조건의 거래 목록으로 간다", async ({ page }, info) => {
  await openDemo(page, "/monthly");
  const trend = page.getByRole("group", { name: "최근 6개월 수입·지출·카드 사용" });
  await expect(trend).toBeVisible();
  const bars = trend.getByRole("link");
  await expect(bars).toHaveCount(6);
  // 막대마다 그 달 값이 담긴 이름이 있다(4.1-5).
  await expect(bars.first()).toHaveAccessibleName(/수입 [\d,]+원, 지출 [\d,]+원, 카드 사용 [\d,]+원/);
  const href = (await bars.first().getAttribute("href"))!;
  const month = /month=(\d{4}-\d{2})/.exec(href)![1];
  await bars.first().click();
  await expect(page).toHaveURL(new RegExp(`/monthly\\?month=${month}$`));
  await expect(page.locator("main")).toContainText("최근 6개월");

  // 도넛은 화면 읽기 프로그램용 이름이 있다.
  await expect(page.getByRole("img", { name: /^카드 사용: / })).toBeVisible();
  await shot(page, info, "monthly-first-month");

  const cardPanel = page.locator("section", { has: page.getByRole("heading", { name: "카드 사용" }) });
  const line = cardPanel.getByRole("link").first();
  const name = (await line.locator("span.truncate").textContent())!.trim();
  await line.click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?kind=card&month=${month}&category=(\\d+|none)$`));
  // 거르기가 그 카테고리로 열리고, 목록의 거래는 모두 그 카테고리다.
  await expect(page.getByRole("combobox", { name: "카테고리", exact: true }).locator("option:checked")).toHaveText(name);
  const rows = page.locator("[data-transaction-row]");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const text of await rows.allTextContents()) expect(text).toContain(name);
});

test.describe("브라우저 시간대가 UTC가 아닐 때", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("거래 목록: 날짜마다 머리줄이 하나이고 요일이 맞으며, 머리줄 아래 거래 수의 합이 요약 카드의 건수와 같다", async ({ page }, info) => {
    await openDemo(page, "/transactions?month=all");
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("America/Los_Angeles");
    const headers = page.locator("[data-day-header] time");
    const dates = await headers.evaluateAll((els) => els.map((e) => [e.getAttribute("datetime")!, e.textContent!.trim()]));
    expect(dates.length).toBeGreaterThan(10);
    expect(new Set(dates.map(([d]) => d)).size).toBe(dates.length);
    const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
    // 알려진 날짜로 계산식 자체를 확인한다: 2026-10-23은 금요일이다.
    expect(WEEKDAYS[new Date(Date.UTC(2026, 9, 23)).getUTCDay()]).toBe("금");
    for (const [date, text] of dates) {
      const [y, m, d] = date.split("-").map(Number);
      expect(text).toBe(`${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`);
    }
    const rows = await page.locator("[data-transaction-row]").count();
    const stat = page.locator("main").getByText(/^[\d,]+건$/).first();
    expect(Number((await stat.textContent())!.replace(/[^\d]/g, ""))).toBe(rows);
    await shot(page, info, "transactions-la");
  });
});

test("거래 목록 800px: 가로 스크롤 없이 수정 버튼이 화면 안에 있다", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "데스크톱 프로젝트에서 폭만 바꿔 본다");
  await page.setViewportSize({ width: 800, height: 900 });
  await openDemo(page, "/transactions?month=all");
  await expectNoHorizontalScroll(page);
  const edit = page.getByRole("button", { name: "수정" }).first();
  await expect(edit).toBeInViewport();
  const box = (await edit.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(800);
  await shot(page, info, "transactions-800");
});

test("카테고리 색·아이콘을 키보드로 바꾸면 카테고리 화면과 거래 목록 배지에 새 색이 보인다", async ({ page }, info) => {
  await loginAs(page, byProject(info, "user4", "user14"));
  // 거래 하나를 만든다(가짜 파일, 계정 만들고 올리기).
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(HANA_1));
  const create = page.getByRole("button", { name: "계정 만들고 올리기" });
  const applied = page.locator("main").getByText(/^반영함/);
  await expect(create.or(applied).first()).toBeVisible();
  if (await create.isVisible()) await create.click();
  await expect(applied).toBeVisible();
  // 올린 직후 결과 표가 보이는 상태로 가로 스크롤이 없다(4.6-1).
  await expectNoHorizontalScroll(page);

  await open(page, "/categories");
  await page.getByRole("button", { name: "외식·배달 고치기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "주황" })).toBeChecked();
  await expectAccessibleNames(page);
  // 키보드만: 고른 색에 초점을 두고 화살표로 다음 색, Tab으로 아이콘 묶음, 화살표로 다음 아이콘, 저장 버튼에서 Enter
  await dialog.getByRole("radio", { name: "주황" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "호박" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("radio", { name: "식기" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "커피" })).toBeChecked();
  await shot(page, info, "category-edit-dialog");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "저장" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  // 호박색 글자(#b45309)
  const AMBER = "rgb(180, 83, 9)";
  const row = page.locator("[data-category-row]").filter({ hasText: "외식·배달" });
  await expect(row.locator("span[aria-hidden=true]").first()).toHaveCSS("color", AMBER);

  await open(page, "/transactions?month=all");
  const tx = page.getByRole("row").filter({ hasText: "가짜마트" });
  const change = tx.getByRole("combobox", { name: "카테고리 바꾸기" });
  await change.selectOption({ label: "외식·배달" });
  await expect(change.locator("option:checked")).toHaveText("외식·배달");
  // 저장이 끝나 화면이 다시 그려지면(배지 글자가 바뀌면) 새로 연다.
  await expect(tx.getByText("외식·배달", { exact: true }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await open(page, "/transactions?month=all");
  const badge = page.getByRole("row").filter({ hasText: "가짜마트" }).locator("span", { hasText: /^외식·배달$/ }).first();
  await expect(badge).toHaveCSS("color", AMBER);
});

test("데이터 없는 사용자: 자산 현황·월별·거래 목록이 오류 없이 안내를 보여 준다", async ({ page }, info) => {
  await loginAs(page, byProject(info, "user5", "user15"));
  for (const [url, text] of [
    ["/home", "계정이 없습니다."],
    ["/monthly", "이 달에는 거래가 없습니다."],
    ["/transactions", "거래가 없습니다."],
  ] as const) {
    await open(page, url);
    await expect(page.locator("main")).toContainText(text);
    // 6개월 추이도 빈 그래프 대신 안내를 보여 준다(4.1-5).
    if (url === "/monthly") {
      await expect(page.locator("main")).toContainText("최근 6개월에 거래가 없습니다.");
      await expect(page.getByRole("group", { name: "최근 6개월 수입·지출·카드 사용" })).toHaveCount(0);
    }
    await expect(page.getByText("문제가 생겼습니다")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, info, `empty${url.replace("/", "-")}`);
  }
});

test("소개 화면: 예시 요약 카드의 금액이 어느 폭에서도 카드 밖으로 넘치지 않는다", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "데스크톱 프로젝트에서 폭만 바꿔 본다");
  for (const width of [375, 640, 768, 800, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/");
    for (const text of ["3,412,000원", "2,036,500원", "1,284,300원"]) {
      const value = page.getByText(text, { exact: true });
      const card = value.locator("xpath=..");
      const [v, c] = [(await value.boundingBox())!, (await card.boundingBox())!];
      expect(v.x + v.width, `${width}px ${text}`).toBeLessThanOrEqual(c.x + c.width);
    }
  }
});
