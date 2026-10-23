import { describe, expect, it } from "vitest";
import { kisParser } from "./kis";
import { kisSheets } from "./test-sheets";
import type { Cell } from "./types";

// 첫째 줄: 거래일, 거래종류, 입금액, 수수료, 잔액, 출금표시내용, 상대계좌, 상대금융기관
// 둘째 줄: 거래시각, 출금액, 입금표시내용, 상대계좌명, 거래채널
const trade = (first: Cell[], second: Cell[]): [Cell[], Cell[]] => [first, second];

describe("한국투자증권 파서", () => {
  it("<tr> 2개를 거래 하나로 묶고, 최신순을 뒤집으며, 계좌정보의 괄호 앞을 계정 찾기 값으로 쓴다", () => {
    const parsed = kisParser.parse(
      kisSheets([
        trade(["2026.07.19", "타사이체출금", "0", "0", "660,001", "홍길동", "111", "KB국민은행"], ["23:09:50", "10,000,000", "홍길동", "홍길동", "스마트폰"]),
        trade(["2026.07.04", "ETF분배금입금", "26,775", "0", "10,660,001", "", "", ""], ["15:41:05", "0", "", "", ""]),
      ]),
    );
    expect(parsed.accountKey).toBe("12345678-01");
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions).toEqual([
      // 표시내용·상대계좌명이 모두 비면 거래종류
      expect.objectContaining({ date: "2026-07-04", time: "15:41:05", amount: 26_775, description: "ETF분배금입금", method: "ETF분배금입금", balanceAfter: 10_660_001 }),
      expect.objectContaining({ date: "2026-07-19", time: "23:09:50", amount: -10_000_000, description: "홍길동", method: "타사이체출금", balanceAfter: 660_001 }),
    ]);
    expect(parsed.transactions[1].raw).toMatchObject({ 상대금융기관: "KB국민은행", 거래채널: "스마트폰" });
  });

  it("입금이면 입금표시내용, 비면 상대계좌명을 description으로 쓴다", () => {
    const parsed = kisParser.parse(
      kisSheets([
        trade(["2026.07.05", "타사이체입금", "1,000", "0", "2,000", "", "", ""], ["10:00:01", "0", "", "김철수", ""]),
        trade(["2026.07.04", "타사이체입금", "1,000", "0", "1,000", "", "", ""], ["10:00:00", "0", "용돈", "김철수", ""]),
      ]),
    );
    expect(parsed.transactions.map((t) => t.description)).toEqual(["용돈", "김철수"]);
  });

  it("원화 금액이 없는 USD 행은 넣지 않고, 수수료가 있으면 오류", () => {
    const usd = trade(["2026.07.04", "외화예탁금이용료입금 USD", "0", "0", "1,000", "", "", ""], ["10:00:00", "0", "", "", ""]);
    expect(kisParser.parse(kisSheets([usd])).transactions).toEqual([]);
    const fee = trade(["2026.07.04", "타사이체출금", "0", "500", "1,000", "", "", ""], ["10:00:00", "1,000", "", "", ""]);
    expect(() => kisParser.parse(kisSheets([fee]))).toThrow("수수료");
  });
});
