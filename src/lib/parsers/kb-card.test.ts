import { describe, expect, it } from "vitest";
import { USD_KRW_RATE, kbCardParser } from "./kb-card";
import { kbCardSheets } from "./test-sheets";
import type { Cell } from "./types";

// 이용일, 이용시간, 이용고객명, 이용카드명, 이용하신곳, 국내이용금액, 해외이용금액, 결제방법, 가맹점정보, 할인금액, 적립포인트리, 상태, 결제예정일, 승인번호
const row = (over: Partial<Record<number, Cell>> = {}): Cell[] => {
  const r: Cell[] = ["2026-07-10", "20:29", "홍길동", "KB카드", "가게", 10_000, 0, "일시불", "", 0, 0, "전표매입", "2026-08-14", "0001"];
  Object.entries(over).forEach(([i, v]) => (r[+i] = v!));
  return r;
};

describe("국민카드 파서", () => {
  it("상태로 부호를 정한다: 전표매입·EDC는 지출, 취소전표매입은 환불, 승인취소는 넣지 않는다", () => {
    const parsed = kbCardParser.parse(
      kbCardSheets([
        row({ 0: "2026-07-14", 5: 400_000, 11: "취소전표매입", 12: "" }),
        row({ 0: "2026-07-13", 5: 37_100, 11: "승인취소", 12: "" }),
        row({ 0: "2026-07-12", 5: 400_000, 11: "EDC특약가맹점취소승인발생매출건" }),
        row({ 0: "2026-07-11" }),
      ]),
    );
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-07-11", -10_000],
      ["2026-07-12", -400_000],
      ["2026-07-14", 400_000],
    ]);
    expect(parsed.transactions[0]).toMatchObject({ time: "20:29", description: "가게", method: "일시불", cardLabel: "KB카드", balanceAfter: null });
  });

  it("금액은 할인 후 금액이고, 전액 할인이면 넣지 않는다(결정 D3)", () => {
    const parsed = kbCardParser.parse(kbCardSheets([row({ 5: 72_050, 9: 17_000 }), row({ 5: 5_000, 9: 5_000 })]));
    expect(parsed.transactions.map((t) => t.amount)).toEqual([-55_050]);
  });

  it("해외 결제는 고정 환율로 원화를 어림하고 method에 표시한다(결정 D2)", () => {
    const parsed = kbCardParser.parse(kbCardSheets([row({ 5: 0, 6: 14.48 })]));
    expect(parsed.transactions[0]).toMatchObject({ amount: -Math.round(14.48 * USD_KRW_RATE), method: "일시불 해외(어림)" });
    expect(parsed.transactions[0].raw).toMatchObject({ "해외이용금액($)": 14.48 });
  });

  it("모르는 상태, 국내·해외 금액이 함께 있으면 오류", () => {
    expect(() => kbCardParser.parse(kbCardSheets([row({ 11: "부분취소" })]))).toThrow("상태");
    expect(() => kbCardParser.parse(kbCardSheets([row({ 6: 1.5 })]))).toThrow("조합");
  });
});
