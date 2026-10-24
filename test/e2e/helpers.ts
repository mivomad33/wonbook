import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

// 스크린샷은 저장소 밖(비공개 문서 폴더의 지금 명세서 아래)에 둔다(public-multiuser 4.9-2, design-refresh 4.8-1).
const SHOTS = path.join(process.cwd(), "docs/specs/2026-10-design-refresh/evidence/e2e");
export const FEEDBACK_HREF = `mailto:mivomad33@gmail.com?subject=${encodeURIComponent("Wonbook 의견")}`;

/** 개발 서버가 첫 연결 때 다시 읽을 수 있어 잠시 기다린 뒤 하이드레이션을 확인한다. */
export async function ready(page: Page): Promise<void> {
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => Boolean((window as unknown as { next?: { router?: unknown } }).next?.router));
}

export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await ready(page);
}

export async function loginAs(page: Page, who: string): Promise<void> {
  await open(page, `/api/auth/dev-login?as=${who}`);
  await expect(page).toHaveURL(/\/home$/);
}

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = path.join(SHOTS, info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** 가로 스크롤이 없다(4.6-3) */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(1);
}

/** 보이는 버튼·입력란에 접근 가능한 이름이 있다(4.10-9) */
export async function expectAccessibleNames(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
    };
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label") ?? "";
      const by = (el.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join("");
      const labels = "labels" in el ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? "").join("") : "";
      const text = el.tagName === "BUTTON" || el.tagName === "A" ? (el.textContent ?? "") : "";
      return (aria + by + labels + text + (el.getAttribute("title") ?? "")).trim();
    };
    return [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=combobox]")]
      .filter((el) => visible(el) && !(el as HTMLInputElement).disabled)
      .filter((el) => !nameOf(el) && !(el.tagName === "A" && el.querySelector("img[alt], svg[aria-label]")))
      .map((el) => el.outerHTML.slice(0, 160));
  });
  expect(unnamed).toEqual([]);
}

export async function expectFeedbackLink(page: Page): Promise<void> {
  const links = page.locator(`a[href="${FEEDBACK_HREF}"]`);
  expect(await links.count()).toBeGreaterThan(0);
}
