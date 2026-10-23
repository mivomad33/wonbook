import { describe, expect, it } from "vitest";
import { hanaBankParser } from "./hana-bank";
import { hanaBankSheets } from "./test-sheets";

describe("하나은행 파서", () => {
  it("최신순 행을 뒤집고, 금액은 입금액 − 출금액, 컬럼을 대응한다", () => {
    const parsed = hanaBankParser.parse(
      hanaBankSheets([
        ["2026-07-20 09:00:00", "하나카드", "하나카드", 50_000, 0, 150_000, "관저동"],
        ["2026-07-10 10:30:15", "대체", "급여", 0, 200_000, 200_000, "기관사업부"],
      ]),
    );
    expect(parsed.institution).toBe("hana_bank");
    expect(parsed.accountKey).toBe("111-222222-33333");
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions).toEqual([
      expect.objectContaining({ date: "2026-07-10", time: "10:30:15", amount: 200_000, description: "급여", method: "대체", memo: null, cardLabel: null, balanceAfter: 200_000 }),
      expect.objectContaining({ date: "2026-07-20", time: "09:00:00", amount: -50_000, description: "하나카드", method: "하나카드", balanceAfter: 150_000 }),
    ]);
    expect(parsed.transactions[0].raw).toMatchObject({ 거래일시: "2026-07-10 10:30:15", 거래점: "기관사업부" });
  });

  it("입금액·출금액이 둘 다 0이거나 둘 다 있으면 오류", () => {
    expect(() => hanaBankParser.parse(hanaBankSheets([["2026-07-10 10:00:00", "대체", "x", 0, 0, 0, ""]]))).toThrow("7행");
    expect(() => hanaBankParser.parse(hanaBankSheets([["2026-07-10 10:00:00", "대체", "x", 1, 1, 0, ""]]))).toThrow("하나만");
  });

  it("거래일이 조회기간 밖이면 오류", () => {
    expect(() => hanaBankParser.parse(hanaBankSheets([["2026-08-01 10:00:00", "대체", "x", 0, 1, 1, ""]]))).toThrow("조회기간");
  });

  it("거래가 없는 파일도 기간을 돌려준다", () => {
    const parsed = hanaBankParser.parse(hanaBankSheets([]));
    expect(parsed.transactions).toEqual([]);
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });

  it("컬럼 머리글이 바뀌면 오류", () => {
    const sheets = hanaBankSheets([]);
    sheets[0][5] = ["거래일시", "구분", "적요", "출금액", "입금액", "잔액", "거래점", "메모"];
    expect(() => hanaBankParser.parse(sheets)).toThrow("머리글");
  });

  describe("청약 계좌 파일(입금 컬럼 `입금(납부회차)`)", () => {
    const sheets = (rows: (string | number)[][]) => hanaBankSheets(rows, "2026-07-01 ~ 2026-07-31", "입금(납부회차)");

    it("`금액(회차)`에서 금액만 읽고, 회차는 raw에만 남는다", () => {
      const parsed = hanaBankParser.parse(
        sheets([
          ["2026-07-20 04:43:33", "청약종합", "11122222233333", 0, "20,000(91)", 40_000, "관저동"],
          ["2026-07-01 04:42:53", "청약종합", "11122222233333", 0, "20,000(90)", 20_000, "관저동"],
        ]),
      );
      expect(parsed.transactions).toEqual([
        expect.objectContaining({ date: "2026-07-01", amount: 20_000, description: "11122222233333", method: "청약종합", memo: null, balanceAfter: 20_000 }),
        expect.objectContaining({ date: "2026-07-20", amount: 20_000, balanceAfter: 40_000 }),
      ]);
      expect(parsed.transactions[0].raw).toMatchObject({ "입금(납부회차)": "20,000(90)" });
    });

    it("숫자 입금 칸도 읽는다", () => {
      const parsed = hanaBankParser.parse(sheets([["2026-07-01 04:42:53", "청약종합", "x", 0, 20_000, 20_000, ""]]));
      expect(parsed.transactions[0].amount).toBe(20_000);
    });

    it("모르는 입금 값은 행 번호가 든 오류", () => {
      for (const value of ["20,000", "2만(91)", "20,000(91회)"]) {
        expect(() => hanaBankParser.parse(sheets([["2026-07-01 04:42:53", "청약종합", "x", 0, value, 20_000, ""]])), value).toThrow("7행");
      }
    });

    it("입금 컬럼 머리글이 둘 다 아니면 오류", () => {
      expect(() => hanaBankParser.parse(hanaBankSheets([], undefined, "입금"))).toThrow("머리글");
    });
  });
});
