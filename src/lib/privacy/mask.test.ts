import { describe, expect, it } from "vitest";
import { maskAccountNumbers } from "./mask";

describe("maskAccountNumbers", () => {
  it.each([
    ["12345678901234", "****1234"],
    ["이체 111-222222-33333 보냄", "이체 ****3333 보냄"],
    ["123456 01 234567", "****4567"],
    ["KB_거래내역조회(123456-01-234567_20261018195710).xls", "KB_거래내역조회(****4567_****5710).xls"],
    ["1234567890", "****7890"],
  ])("%s → %s", (input, out) => {
    expect(maskAccountNumbers(input)).toBe(out);
  });

  it("9자리 이하 숫자와 날짜·금액은 그대로 둔다", () => {
    for (const s of ["123456789", "2026-10-18", "20,000(91)", "네이버1234", "GS25 역삼중앙점", "12:30:00"]) expect(maskAccountNumbers(s)).toBe(s);
  });

  it("같은 번호는 같은 결과가 된다", () => {
    expect(maskAccountNumbers("1112222223333 3")).toBe(maskAccountNumbers("111-222222-33333"));
  });

  it("null은 null", () => {
    expect(maskAccountNumbers(null)).toBeNull();
  });
});
