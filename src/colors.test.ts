// 화면 코드에 색 값을 직접 쓰지 않는다(design-refresh 명세서 4.1-2).
// src/app, src/components(ui/ 제외)의 .ts·.tsx·.css에서 16진수 색과 oklch(·rgb( 값은 색 토큰 파일과 예외에만 있고,
// src/app에는 Tailwind 기본 팔레트 색 클래스가 없다. 카테고리 팔레트 정의(src/lib/category-style.ts)는 검사 범위 밖이다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname);
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return rel(p) === "components/ui" ? [] : files(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

// 색 토큰 파일과 예외(전역 오류 화면, 로고). 소개 화면은 구글 브랜드 색 하나만 예외다.
const TOKEN_FILE = "app/globals.css";
const WHOLE_FILE_EXCEPTIONS = ["app/global-error.tsx", "components/logo.tsx"];
const ALLOWED_VALUES: Record<string, string[]> = { "app/page.tsx": ["#4285f4"] };

const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\(/g;
const PALETTE_CLASS =
  /\b(?:text|bg|border|fill|stroke|ring|from|to|via|outline|decoration|divide|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

// 주석을 빼고 본다(주석 속 "#1" 같은 글자를 색으로 보지 않게).
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("색 값 직접 쓰기 금지(4.1-2)", () => {
  const all = [...files(path.join(SRC, "app")), ...files(path.join(SRC, "components"))];

  it("검사할 파일을 찾는다", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.map(rel)).toContain("app/page.tsx");
  });

  it("16진수 색과 oklch(·rgb( 값은 색 토큰 파일과 예외에만 있다", () => {
    const found: string[] = [];
    for (const f of all) {
      const r = rel(f);
      if (r === TOKEN_FILE || WHOLE_FILE_EXCEPTIONS.includes(r)) continue;
      for (const m of stripComments(fs.readFileSync(f, "utf8")).matchAll(COLOR_VALUE)) {
        if (!(ALLOWED_VALUES[r] ?? []).includes(m[0].toLowerCase())) found.push(`${r}: ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("src/app에 Tailwind 기본 팔레트 색 클래스가 없다", () => {
    const found = all
      .filter((f) => rel(f).startsWith("app/"))
      .flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(PALETTE_CLASS)].map((m) => `${rel(f)}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it("검사식이 실제 예를 잡는다", () => {
    expect("text-green-700 bg-amber-50".match(PALETTE_CLASS)).toEqual(["text-green-700", "bg-amber-50"]);
    expect('style={{ color: "#4285f4" }} oklch(0.5 0 0)'.match(COLOR_VALUE)).toEqual(["#4285f4", "oklch("]);
  });
});
