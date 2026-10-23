import { describe, expect, it } from "vitest";
import { toDate, toDateTime, toNumber, toPeriod, text } from "./common";

describe("파서 공통 칸 읽기", () => {
  it("전각 공백만 든 칸은 빈 칸이다", () => {
    expect(text("　")).toBe("");
    expect(text("  가  ")).toBe("가");
  });

  it("쉼표가 든 숫자 문자열을 숫자로 바꾸고, 글자는 오류", () => {
    expect(toNumber("1,758,347", "x")).toBe(1_758_347);
    expect(toNumber("-20,000", "x")).toBe(-20_000);
    expect(toNumber(14.48, "x")).toBe(14.48);
    expect(() => toNumber("", "x")).toThrow("숫자");
    expect(() => toNumber("1만", "x")).toThrow("숫자");
  });

  it("날짜는 . 과 - 구분자를 읽고, 없는 날짜는 오류", () => {
    expect(toDate("2026.07.01", "x")).toBe("2026-07-01");
    expect(toDate("2026-07-01", "x")).toBe("2026-07-01");
    expect(() => toDate("2026-02-30", "x")).toThrow("날짜");
    expect(() => toDateTime("2026-07-01", "x")).toThrow("시각");
  });

  it("조회기간은 ~나 - 구분자, 줄바꿈·괄호가 섞여도 읽는다", () => {
    const want = { start: "2025-10-18", end: "2026-10-18" };
    expect(toPeriod("2025-10-18 ~ 2026-10-18")).toEqual(want);
    expect(toPeriod("2025.10.18 - 2026.10.18")).toEqual(want);
    expect(toPeriod("[조회기간: 2025.10.18 ~ 2026.10.18]")).toEqual(want);
    expect(toPeriod("2025.10.18\n\t\t~\n\t\t2026.10.18")).toEqual(want);
    expect(() => toPeriod("")).toThrow("조회기간");
    expect(() => toPeriod("2026.10.18 ~ 2025.10.18")).toThrow("늦습니다");
  });
});
