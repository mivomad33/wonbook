import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Basis } from "./basis";
import { checkContents, checkPages, forbiddenFile } from "./output-check";
import { checkJsonLd, checkPublicPage, checkSitemap, SITEMAP_URLS } from "./page-rules";

// 실제 기준(비공개)은 쓰지 않고 가짜 기준으로 검사 동작만 본다. 실제 기준으로 하는 확인은 output-check.ts --self-test.
const basis: Basis = {
  patterns: [{ text: "planted-forbidden", word: false }, { text: "wordonly", word: true }],
  secrets: ["s3cret-value-xyz"],
  accountIds: ["11122233334444"],
};

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-output-test-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, ".vercel/output", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

describe("배포 결과물 검사 - 내용", () => {
  it("일부러 넣은 금지 문자열·비밀 값·계좌 식별값·테스트 로그인 흔적을 잡는다", () => {
    const p = project({
      "static/a.js": "x='Planted-Forbidden'",
      "static/w.js": "x = wordonly;",
      "static/w2.js": "x = notwordonlyhere;",
      "static/b.js": "k='s3cret-value-xyz'",
      "static/c.js": "n='111-222 333-34444'",
      "static/d.js": "fetch('/api/auth/dev-login')",
      "static/clean.js": "console.log(1)",
    });
    const { failures } = checkContents(p, basis);
    const has = (kind: string, file: string) => failures.some((f) => f.startsWith(kind) && f.endsWith(file));
    expect(has("금지 문자열", "a.js")).toBe(true);
    expect(has("금지 문자열", "w.js")).toBe(true);
    expect(has("금지 문자열", "w2.js")).toBe(false);
    expect(has("비밀 값", "b.js")).toBe(true);
    expect(has("내 계좌 식별값", "c.js")).toBe(true);
    expect(has("테스트 로그인 흔적", "d.js")).toBe(true);
    expect(failures.some((f) => f.endsWith("clean.js"))).toBe(false);
  });

  it("깨끗한 결과물은 내용 검사를 통과한다", () => {
    expect(checkContents(project({ "static/a.js": "console.log(1)" }), basis).failures).toEqual([]);
  });

  it("금지 파일을 잡는다", () => {
    expect(forbiddenFile("functions/x.func/data/wonbook.db")).toBe("data/ 파일");
    expect(forbiddenFile("functions/x.func/samples/a.txt")).toBe("samples/ 파일");
    expect(forbiddenFile("docs/spec.md")).toBe("docs/ 파일");
    expect(forbiddenFile("static/a.xlsx")).not.toBeNull();
    expect(forbiddenFile("static/a.XLS")).not.toBeNull();
    expect(forbiddenFile("functions/x.func/.env.local")).toBe("환경 변수 파일");
    expect(forbiddenFile("functions/x.func/app.db")).toBe("DB 파일");
    expect(forbiddenFile("functions/x.func/node_modules/pkg/docs/readme.md")).toBeNull();
    expect(forbiddenFile("static/_next/a.js")).toBeNull();
  });
});

describe("배포 결과물 검사 - 공개 페이지", () => {
  it("공개 페이지·robots·sitemap·og 이미지가 없으면 실패한다", async () => {
    const failures = await checkPages(project({ "static/x.js": "" }));
    expect(failures).toContain("정적 페이지가 없습니다: /");
    expect(failures).toContain("정적 페이지가 없습니다: /privacy");
    expect(failures).toContain("robots.txt가 결과물에 없습니다");
    expect(failures).toContain("sitemap.xml이 결과물에 없습니다");
    expect(failures.some((f) => f.startsWith("og:image 파일"))).toBe(true);
  });

  it("noindex·빠진 태그·틀린 JSON-LD를 잡는다", () => {
    const html = '<html lang="ko"><head><title>x</title><meta name="robots" content="noindex"/><script type="application/ld+json">{"@type":"Thing"}</script></head></html>';
    const bad = checkPublicPage(html, "/");
    expect(bad).toContain("noindex가 있습니다");
    expect(bad).toContain("title 값이 다릅니다");
    expect(bad.some((b) => b.startsWith("og:image "))).toBe(true);
    expect(bad).toContain("아이콘 링크 /icon.svg가 없습니다");
    expect(checkJsonLd(html).length).toBeGreaterThan(0);
  });

  it("canonical·og:url은 정규화해 견준다: 루트는 끝 \"/\"가 없어도 같고, 다른 주소는 잡는다", () => {
    const page = (url: string) => `<html lang="ko"><head><link rel="canonical" href="${url}"/><meta property="og:url" content="${url}"/></head></html>`;
    const urlErrors = (html: string) => checkPublicPage(html, "/").filter((b) => b.startsWith("canonical") || b.startsWith("og:url"));
    expect(urlErrors(page("https://wonbook.vercel.app"))).toEqual([]);
    expect(urlErrors(page("https://wonbook.vercel.app/"))).toEqual([]);
    expect(urlErrors(page("https://wonbook.vercel.app/home"))).toEqual(["canonical 값이 다릅니다", "og:url 값이 다릅니다"]);
  });

  it("sitemap은 원본 모듈의 주소 목록과 같아야 한다", () => {
    const xml = (urls: string[]) => `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
    expect(checkSitemap(xml(SITEMAP_URLS))).toEqual([]);
    expect(checkSitemap(xml([...SITEMAP_URLS, "https://wonbook.vercel.app/home"]))).not.toEqual([]);
  });
});
