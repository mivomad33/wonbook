import { describe, expect, it } from "vitest";
import { hanaCardParser } from "./hana-card";
import { hanaCardSheets } from "./test-sheets";
import type { Cell } from "./types";

// 이용일, 이용시간, 이용카드, 승인번호, 가맹점명, 승인금액, 포인트사용, 이용구분, 할부기간, 매입, 매입금액, 매입할인금액, 매입취소금액, 상태
const row = (over: Partial<Record<number, Cell>> = {}): Cell[] => {
  const r: Cell[] = ["2026.07.10", "12:00:00", "본인 1234", "0001", "가게", 10_000, 0, "일시불", "-", "매입", 10_000, 0, 0, "정상"];
  Object.entries(over).forEach(([i, v]) => (r[+i] = v!));
  return r;
};

describe("하나카드 파서", () => {
  it("매입이면 매입금액, 미매입이면 승인금액을 지출(−)로 넣는다(결정 D3)", () => {
    const parsed = hanaCardParser.parse(
      hanaCardSheets([
        row({ 0: "2026.07.20", 4: "ANTHROPIC  +14152360599 US", 5: 29_000, 7: "신판", 9: "미매입", 10: 0 }),
        row({ 0: "2026.07.15", 5: 30_000, 7: "신판", 10: 30_500 }),
      ]),
    );
    expect(parsed.accountKey).toBeNull();
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-07-15", -30_500],
      ["2026-07-20", -29_000],
    ]);
    expect(parsed.transactions[0]).toMatchObject({ time: "12:00:00", description: "가게", method: "신판", cardLabel: "본인 1234", balanceAfter: null });
  });

  it("취소 행은 넣지 않고, 끝부분 집계 행은 거래로 보지 않는다", () => {
    const parsed = hanaCardParser.parse(hanaCardSheets([row({ 13: "취소" }), row()]));
    expect(parsed.transactions).toHaveLength(1);
  });

  it("할부는 결제한 날 전체 금액을 넣고 method에 개월 수를 붙인다", () => {
    const parsed = hanaCardParser.parse(hanaCardSheets([row({ 5: 300_000, 7: "할부", 8: "3", 10: 300_000 })]));
    expect(parsed.transactions[0]).toMatchObject({ amount: -300_000, method: "할부 3개월" });
  });

  it("모르는 상태·매입 값, 0이어야 하는 컬럼에 값이 있으면 오류", () => {
    expect(() => hanaCardParser.parse(hanaCardSheets([row({ 13: "부분취소" })]))).toThrow("상태");
    expect(() => hanaCardParser.parse(hanaCardSheets([row({ 9: "보류" })]))).toThrow("매입");
    expect(() => hanaCardParser.parse(hanaCardSheets([row({ 12: 1_000 })]))).toThrow("매입취소금액");
    expect(() => hanaCardParser.parse(hanaCardSheets([row({ 6: 500 })]))).toThrow("포인트사용");
  });
});
