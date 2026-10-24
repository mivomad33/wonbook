// 글자 색 대비(design-refresh 명세서 4.1-3, 4.5-5, 4.8-4). 흰 바탕과 쓰이는 바탕 위에서 4.5:1 이상인지 본다.
// 색 토큰은 globals.css의 :root 값을 읽는다(16진수와 무채색 oklch). 배지 바탕은 카테고리 색을 옅게(SOFT_ALPHA) 흰 바탕에 겹친 색이다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, SOFT_ALPHA, UNCATEGORIZED_COLOR } from "@/lib/category-style";

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];

const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

function parse(value: string): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  // 무채색 oklch(L 0 0)만 쓴다: 선형 밝기 = L³
  const gray = /^oklch\(([\d.]+) 0 0\)$/.exec(v);
  if (gray) {
    const lin = Number(gray[1]) ** 3;
    const s = lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
    return [s * 255, s * 255, s * 255];
  }
  throw new Error(`읽을 수 없는 색: ${v}`);
}
const token = (name: string): Rgb => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
  if (!m) throw new Error(`토큰 ${name}이 없습니다`);
  return parse(m[1]);
};
const mix = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("색 토큰 대비(4.8-4)", () => {
  it.each([
    ["foreground", "background"],
    ["foreground", "subtle"],
    ["muted-foreground", "background"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "subtle"],
    ["muted-foreground", "brand-soft"],
    ["primary-foreground", "primary"],
    ["brand-soft-foreground", "brand-soft"],
    ["notice-foreground", "notice"],
    ["sidebar-accent-foreground", "sidebar-accent"],
    ["sidebar-foreground", "sidebar"],
    ["primary", "background"],
  ])("%s 글자 / %s 바탕이 4.5:1 이상이다", (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("자산 현황 알림의 옅은 글자(notice-foreground 80%)도 4.5:1 이상이다", () => {
    expect(contrast(mix(token("notice-foreground"), token("notice"), 0.8), token("notice"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("포커스 링 대비(4.8-4)", () => {
  it("포커스 링 색이 흰 바탕에서 3:1 이상이다(WCAG 1.4.11)", () => {
    for (const name of ["ring", "sidebar-ring"]) expect(contrast(token(name), token("background"))).toBeGreaterThanOrEqual(3);
  });
});

describe("금액 색 대비(4.1-3)", () => {
  it.each(["income", "expense"])("%s 색이 흰 바탕·요약 카드·머리줄 바탕에서 4.5:1 이상이다", (name) => {
    for (const bg of ["background", "subtle", "brand-soft"]) expect(contrast(token(name), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("카테고리 배지 대비(4.5-5)", () => {
  it.each([...Object.entries(CATEGORY_COLORS), ["미분류", UNCATEGORIZED_COLOR] as const])("%s 배지 글자가 배지 바탕과 흰 바탕에서 4.5:1 이상이다", (_name, c) => {
    const text = parse(c.text);
    const badge = mix(parse(c.base), WHITE, SOFT_ALPHA / 255);
    expect(contrast(text, badge)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, WHITE)).toBeGreaterThanOrEqual(4.5);
  });
});
