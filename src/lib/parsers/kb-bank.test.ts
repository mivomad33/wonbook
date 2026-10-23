import { describe, expect, it } from "vitest";
import { kbBankParser } from "./kb-bank";
import { kbBankSheets } from "./test-sheets";

describe("국민은행 파서", () => {
  it("상대방은 description, 적요는 method, 최신순을 뒤집는다", () => {
    const parsed = kbBankParser.parse(
      kbBankSheets([
        ["2026.07.20 18:17:00", "국민카드", "KB카드출금", "", 30_000, 0, 70_000, "수신상", "　"],
        ["2026.07.10 08:00:00", "전자금융", "청년수당", "", 0, 100_000, 100_000, "농협", "　"],
      ]),
    );
    expect(parsed.accountKey).toBe("123456-01-234567");
    expect(parsed.period).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(parsed.transactions).toEqual([
      expect.objectContaining({ date: "2026-07-10", time: "08:00:00", amount: 100_000, description: "청년수당", method: "전자금융", memo: null, balanceAfter: 100_000 }),
      expect.objectContaining({ date: "2026-07-20", amount: -30_000, description: "KB카드출금", method: "국민카드", balanceAfter: 70_000 }),
    ]);
  });

  it("송금메모는 받는 분과 다를 때만 memo에 넣는다(띄어쓰기만 다르면 같다고 본다)", () => {
    const parsed = kbBankParser.parse(
      kbBankSheets([
        ["2026.07.12 10:00:03", "스마트출금", "주식회사 가나", "주식회사가나", 3, 0, 94, "", ""],
        ["2026.07.12 10:00:02", "스마트출금", "홍길동", "홍길동생일", 2, 0, 97, "", ""],
        ["2026.07.12 10:00:01", "스마트출금", "홍길동", "홍길동", 1, 0, 99, "", ""],
      ]),
    );
    expect(parsed.transactions.map((t) => t.memo)).toEqual([null, "홍길동생일", null]);
  });

  it("같은 일시·같은 금액 거래도 파일 행 순서를 지킨다", () => {
    const parsed = kbBankParser.parse(
      kbBankSheets([
        ["2026.07.12 10:00:00", "FBS입금", "캐시백", "", 0, 100, 1_200, "", ""],
        ["2026.07.12 10:00:00", "FBS입금", "캐시백", "", 0, 100, 1_100, "", ""],
      ]),
    );
    expect(parsed.transactions.map((t) => t.balanceAfter)).toEqual([1_100, 1_200]);
  });
});
