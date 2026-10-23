import { describe, expect, it } from "vitest";
import { stripQuery } from "./analytics-url";

describe("stripQuery", () => {
  it("쿼리와 조각을 지운다", () => {
    expect(stripQuery("https://wonbook.vercel.app/transactions?account=12&month=2026-10#x")).toBe("https://wonbook.vercel.app/transactions");
  });
  it("쿼리가 없으면 그대로다", () => {
    expect(stripQuery("https://wonbook.vercel.app/home")).toBe("https://wonbook.vercel.app/home");
  });
});
