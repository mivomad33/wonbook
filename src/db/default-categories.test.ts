import { describe, expect, it } from "vitest";
import { isCategoryColor, isCategoryIcon } from "@/lib/category-style";
import { DEFAULT_CATEGORIES } from "./default-categories";

// 처음 카테고리의 색·아이콘(design-refresh 명세서 4.5-2)
describe("처음 카테고리 기본값", () => {
  it("25개 모두 목록 안의 색·아이콘이고 아이콘이 서로 겹치지 않는다", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(25);
    expect(DEFAULT_CATEGORIES.every((c) => isCategoryColor(c.color) && isCategoryIcon(c.icon))).toBe(true);
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.icon)).size).toBe(25);
  });

  it("이동 묶음은 회색이다", () => {
    expect(DEFAULT_CATEGORIES.filter((c) => c.group === "move").map((c) => c.color)).toEqual(["gray", "gray", "gray"]);
  });
});
