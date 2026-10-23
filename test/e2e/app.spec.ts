// 로그인 뒤 핵심 흐름(4.10-1): 계정 만들고 올리기 → 거래 목록 → 카테고리 바꾸기 → 월별, 되돌리기, 카카오뱅크 암호,
// 지원하지 않는 파일, 설정(암호·내보내기·로그아웃·탈퇴), 관리자 화면. 데스크톱과 375px에서 각자 다른 테스트 사용자로 돈다.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { FAKE_KAKAO_PASSWORD, HANA_1, HANA_2, KAKAO, UNSUPPORTED, file } from "./files";
import { expectAccessibleNames, loginAs, open, ready, shot } from "./helpers";

test.describe.configure({ mode: "serial" });
// 화면 폭마다 다른 사용자를 써서 두 프로젝트의 데이터가 섞이지 않게 한다.
const userOf = (info: TestInfo) => (info.project.name === "mobile" ? "user11" : "user1");
const leaverOf = (info: TestInfo) => (info.project.name === "mobile" ? "user19" : "user9");

/** 사이드바 링크를 누른다. 375px에서는 메뉴를 먼저 연다. */
async function clickNav(page: Page, info: TestInfo, name: string) {
  if (info.project.name === "mobile") await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("link", { name }).click();
}

const results = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "이번 결과" }) }).locator("tbody tr");

test("계정 만들고 올리기(키보드만) → 거래 목록에서 카테고리 바꾸기 → 월별", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await open(page, "/upload");
  // 키보드만으로 파일 고르기
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "금융사 파일 고르기" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(file(HANA_1));
  await expect(results(page).first()).toContainText("맞는 계정이 없습니다.");
  await page.getByRole("button", { name: "계정 만들고 올리기" }).click();
  await expect(results(page).first()).toContainText("반영함(계정 만듦)");
  await expectAccessibleNames(page);
  await shot(page, info, "upload-applied");

  await open(page, "/transactions?month=all");
  const row = page.getByRole("row").filter({ hasText: "가짜마트" });
  await expect(row).toBeVisible();
  const select = row.getByRole("combobox", { name: "카테고리 바꾸기" });
  // 배지는 기본 select라 키보드로 초점이 간다. macOS 헤드리스 Chromium은 select 팝업에 키 입력을 넘기지 않아 값은 selectOption으로 고른다
  // (키보드만으로 하는 조작은 위의 파일 고르기가 맡는다, 4.10-9).
  await select.focus();
  await expect(select).toBeFocused();
  await select.selectOption({ label: "장보기" });
  await expect(select.locator("option:checked")).toHaveText("장보기");
  await open(page, "/transactions?month=all");
  await expect(page.getByRole("row").filter({ hasText: "가짜마트" }).getByRole("combobox", { name: "카테고리 바꾸기" }).locator("option:checked")).toHaveText("장보기");
  await shot(page, info, "transactions");

  await open(page, "/monthly");
  await expect(page.locator("main")).toContainText("장보기");
  await expect(page.locator("main")).toContainText("30,000");
  await shot(page, info, "monthly");
});

test("겹치는 파일을 올린 뒤 되돌리면 올리기 전으로 돌아간다", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(HANA_2));
  await expect(results(page).first()).toContainText("반영함");
  await open(page, "/transactions?month=all");
  await expect(page.getByRole("row").filter({ hasText: "가짜카페" })).toBeVisible();

  await open(page, "/upload");
  const recent = page.locator("section", { has: page.getByRole("heading", { name: "최근 업로드 기록" }) });
  await expect(recent).toContainText("hana-2.xlsx");
  await recent.getByRole("button", { name: "되돌리기" }).first().click();
  const dialog = page.getByRole("alertdialog").filter({ hasText: "이 업로드를 되돌리시겠습니까?" });
  await dialog.getByRole("button", { name: "되돌리기" }).click();
  await expect(dialog).toBeHidden();
  await expect(recent).not.toContainText("hana-2.xlsx");
  // 되돌린 업로드는 다시 되돌릴 수 없고, 그 앞 업로드의 되돌리기 자료는 새 업로드 때 지워졌다(4.3-5)
  await expect(recent).toContainText("되돌릴 수 없음");
  await expect(recent.getByRole("button", { name: "되돌리기" })).toHaveCount(0);

  await open(page, "/transactions?month=all");
  await expect(page.getByRole("row").filter({ hasText: "가짜카페" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "가짜마트" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "가짜마트" }).getByRole("combobox", { name: "카테고리 바꾸기" }).locator("option:checked")).toHaveText("장보기");
});

test("카카오뱅크 암호 파일: 틀린 암호는 다시 묻고, 맞으면 올리고 저장한다", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(KAKAO));
  const dialog = page.getByRole("dialog").filter({ hasText: "카카오뱅크 파일 암호" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("암호").fill("wrong-pass");
  await dialog.getByRole("button", { name: "열기" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("암호가 맞지 않습니다. 다시 넣어 주세요.");
  await dialog.getByLabel("암호").fill(FAKE_KAKAO_PASSWORD);
  await dialog.getByRole("button", { name: "열기" }).click();
  await expect(dialog).toBeHidden();
  await expect(results(page).first()).toContainText("맞는 계정이 없습니다.");
  await page.getByRole("button", { name: "계정 만들고 올리기" }).click();
  await expect(results(page).first()).toContainText("반영함");

  // 저장됐으므로 다시 올리면 묻지 않는다
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(KAKAO));
  await expect(results(page).first()).toContainText("반영함");
  await expect(dialog).toBeHidden();
  await open(page, "/settings");
  await expect(page.getByText("저장됨 · 바꾸려면 새 암호를 넣으세요")).toBeVisible();
  await expect(page.getByLabel(/저장됨/)).toHaveValue("");
});

test("지원하지 않는 xlsx는 지원 금융사와 함께 안내한다(4.3-6)", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await open(page, "/upload");
  await expect(page.locator("main")).toContainText("지원하는 금융사: 하나은행, 국민은행, 카카오뱅크, 하나카드, 국민카드, 한국투자증권");
  await page.getByTestId("upload-input").setInputFiles(file(UNSUPPORTED));
  await expect(page.locator("main")).toContainText("지금은 하나은행");
});

test("설정: 암호 저장·지우기, CSV 내려받기", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await open(page, "/settings");
  await expectAccessibleNames(page);
  await shot(page, info, "settings");
  // 지우기 → 저장
  await page.getByRole("button", { name: "지우기" }).click();
  await expect(page.getByText("저장된 암호 없음")).toBeVisible();
  await page.getByLabel("저장된 암호 없음").fill("e2e-new-pass");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("저장됨 · 바꾸려면 새 암호를 넣으세요")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV 내려받기" }).click();
  const csv = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of csv) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = buf.toString("utf8");
  expect(text).toContain("가짜마트");
  expect(text).toContain("가짜분식");
});

test("관리자 화면: 관리자는 들어가고 일반 사용자는 막힌다", async ({ page }, info) => {
  await loginAs(page, userOf(info));
  await expect(page.getByRole("link", { name: "관리자" })).toHaveCount(0);
  await open(page, "/admin");
  await expect(page).toHaveURL(/\/home$/);

  await loginAs(page, "admin");
  await clickNav(page, info, "관리자");
  await expect(page).toHaveURL(/\/admin$/);
  await ready(page);
  await expect(page.getByText("가입자")).toBeVisible();
  const main = await page.locator("main").innerText();
  for (const s of ["가짜마트", "가짜급여", "가짜분식", "user1@test.local", "30,000"]) expect(main).not.toContain(s);
  await shot(page, info, "admin");
});

test("로그아웃하면 소개 화면으로 가고, 이전 세션 쿠키로 앱 화면을 열 수 없다(4.1-3)", async ({ page, context }, info) => {
  await loginAs(page, userOf(info));
  const old = (await context.cookies()).find((c) => c.name === "wonbook_session")!;
  await open(page, "/settings");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await context.addCookies([old]);
  await open(page, "/home");
  await expect(page).toHaveURL(/\/$/);
});

test("탈퇴: 확인 대화상자에 CSV 길이 있고, 탈퇴하면 소개 화면으로 간다(4.1-6)", async ({ page, context }, info) => {
  await loginAs(page, leaverOf(info));
  await open(page, "/upload");
  await page.getByTestId("upload-input").setInputFiles(file(HANA_1));
  await page.getByRole("button", { name: "계정 만들고 올리기" }).click();
  await expect(results(page).first()).toContainText("반영함");
  const old = (await context.cookies()).find((c) => c.name === "wonbook_session")!;

  await open(page, "/settings");
  await page.getByRole("button", { name: "탈퇴하기" }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog.getByRole("link", { name: "거래를 CSV로 내려받으세요" })).toHaveAttribute("href", "/api/export");
  await dialog.getByRole("button", { name: "탈퇴하기" }).click();
  await expect(page).toHaveURL(/\/$/);
  await context.addCookies([old]);
  await open(page, "/home");
  await expect(page).toHaveURL(/\/$/);
});
