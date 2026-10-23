import { describe, expect, it } from "vitest";
import { kakaoBankParser } from "./kakao-bank";
import { kakaoBankSheets } from "./test-sheets";

describe("카카오뱅크 파서", () => {
  it("B열부터 읽고, 쉼표 금액에 구분으로 부호를 붙이며, 오래된 순 그대로 둔다", () => {
    const parsed = kakaoBankParser.parse(
      kakaoBankSheets([
        ["2026.07.05 03:37:39", "입금", "1,124", "1,758,347", "예금이자", "입출금통장 이자", ""],
        ["2026.07.06 12:00:00", "출금", "-20,000", "1,738,347", "", "홍길동", "생일"],
      ]),
    );
    expect(parsed.accountKey).toBe("****-**-***1234");
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions).toEqual([
      expect.objectContaining({ date: "2026-07-05", time: "03:37:39", amount: 1_124, description: "입출금통장 이자", method: "예금이자", memo: null, balanceAfter: 1_758_347 }),
      // 거래구분이 비면 구분을 method로 쓴다
      expect.objectContaining({ date: "2026-07-06", amount: -20_000, description: "홍길동", method: "출금", memo: "생일", balanceAfter: 1_738_347 }),
    ]);
    expect(parsed.transactions[0].raw).toMatchObject({ 거래후잔액: "1,758,347" });
  });

  it("출금은 -표기가 없어도 구분으로 음수가 된다", () => {
    const parsed = kakaoBankParser.parse(kakaoBankSheets([["2026.07.06 12:00:00", "출금", "500", "0", "", "x", ""]]));
    expect(parsed.transactions[0].amount).toBe(-500);
  });

  it("입금인데 -가 있거나 모르는 구분이면 오류", () => {
    expect(() => kakaoBankParser.parse(kakaoBankSheets([["2026.07.06 12:00:00", "입금", "-500", "0", "", "x", ""]]))).toThrow("-가 있습니다");
    expect(() => kakaoBankParser.parse(kakaoBankSheets([["2026.07.06 12:00:00", "이체", "500", "0", "", "x", ""]]))).toThrow("모르는 값");
  });
});
