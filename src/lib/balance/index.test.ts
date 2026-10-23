import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, transactions } from "@/db/schema";
import { computeAdjustments, getBalance, getBalanceBefore, getBalances } from "@/lib/balance";

async function addAccount(db: Db, userId: number, values: Partial<typeof accounts.$inferInsert> = {}) {
  const [row] = await db
    .insert(accounts)
    .values({ userId, name: "계정", kind: "asset", ...values })
    .returning({ id: accounts.id });
  return row.id;
}

async function addTx(db: Db, userId: number, accountId: number, date: string, amount: number, deletedAt: string | null = null) {
  await db.insert(transactions).values({ userId, accountId, kind: "normal", source: "manual", date, amount, deletedAt });
}

describe("잔액 계산(design.md 1.3-D)", () => {
  it("기준일 이전·당일 거래는 빼고 이후 거래만 기초 잔액에 더한다", async () => {
    const { db, userId } = await createTestContext();
    const id = await addAccount(db, userId, { openingBalance: 100_000, openingDate: "2026-10-10" });
    await addTx(db, userId, id, "2026-10-09", -1_000); // 이전
    await addTx(db, userId, id, "2026-10-10", -2_000); // 당일: 기초 잔액은 이 날 하루를 마친 뒤라 이미 들어 있다
    await addTx(db, userId, id, "2026-10-11", 30_000); // 이후
    await addTx(db, userId, id, "2026-11-01", -5_000); // 이후
    expect(await getBalance(db, userId, id)).toBe(125_000);
  });

  it("기준일이 null이면 모든 거래를 더한다", async () => {
    const { db, userId } = await createTestContext();
    const id = await addAccount(db, userId, { openingBalance: 10_000, openingDate: null });
    await addTx(db, userId, id, "2020-01-01", 5_000);
    await addTx(db, userId, id, "2026-10-19", -3_000);
    expect(await getBalance(db, userId, id)).toBe(12_000);
  });

  it("삭제 표시한 거래는 빼고 센다", async () => {
    const { db, userId } = await createTestContext();
    const id = await addAccount(db, userId, { openingBalance: 0 });
    await addTx(db, userId, id, "2026-10-01", 7_000);
    await addTx(db, userId, id, "2026-10-02", -50_000, "2026-10-19T00:00:00.000Z");
    expect(await getBalance(db, userId, id)).toBe(7_000);
  });

  it("거래가 없으면 기초 잔액 그대로이고, 부채는 음수 그대로 돌려준다", async () => {
    const { db, userId } = await createTestContext();
    const asset = await addAccount(db, userId, { openingBalance: 3_000 });
    const liability = await addAccount(db, userId, { kind: "liability", openingBalance: -1_000_000 });
    await addTx(db, userId, liability, "2026-10-01", 200_000); // 갚음
    expect(await getBalance(db, userId, asset)).toBe(3_000);
    expect(await getBalance(db, userId, liability)).toBe(-800_000);
  });

  it("다른 계정 거래는 섞지 않고, 카드 계정은 결과에 넣지 않는다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId);
    const b = await addAccount(db, userId);
    const card = await addAccount(db, userId, { kind: "card", institution: "hana_card" });
    await addTx(db, userId, a, "2026-10-01", 1_000);
    await addTx(db, userId, b, "2026-10-01", 2_000);
    await addTx(db, userId, card, "2026-10-01", -9_000);
    const balances = await getBalances(db, userId);
    expect([...balances.entries()]).toEqual([
      [a, 1_000],
      [b, 2_000],
    ]);
    expect(await getBalance(db, userId, card)).toBeUndefined();
  });
});

describe("날짜로 끊은 잔액(4단계 파일 3.4)", () => {
  it("기준일 조건에 더해 그 날짜 전 거래만 더한다", async () => {
    const { db, userId } = await createTestContext();
    const id = await addAccount(db, userId, { openingBalance: 100_000, openingDate: "2026-10-10" });
    await addTx(db, userId, id, "2026-10-10", -2_000); // 기준일 당일
    await addTx(db, userId, id, "2026-10-11", 30_000);
    await addTx(db, userId, id, "2026-10-15", -5_000); // 끊는 날 당일: 빠진다
    await addTx(db, userId, id, "2026-10-20", -7_000); // 뒤
    await addTx(db, userId, id, "2026-10-12", -1_000, "2026-10-19T00:00:00.000Z"); // 삭제 표시
    expect(await getBalanceBefore(db, userId, id, "2026-10-15")).toBe(130_000);
    expect(await getBalanceBefore(db, userId, id, "2026-10-01")).toBe(100_000);
  });
});

const row = (date: string, amount: number, balanceAfter: number | null = null) => ({ date, amount, balanceAfter });

describe("보정 계산(4단계 파일 3.1·3.2)", () => {
  it("계산 잔액과 그날 마지막 거래 후 잔액이 다른 날마다 차액을 그날 마지막 거래 뒤에 넣는다", async () => {
    const rows = [
      row("2026-10-01", 1_000, 11_000), // 맞음
      row("2026-10-02", -500, 10_700), // 다르게 시작하지만 그날 마지막에서 비교한다
      row("2026-10-02", 300, 11_000), // 계산 10,800 → +200
      row("2026-10-03", -1_000, 10_000), // 앞 보정 위에서 계산하므로 맞음
      row("2026-10-04", 2_000, 11_500), // 계산 12,000 → −500
    ];
    expect(computeAdjustments({ startBalance: 10_000, openingDate: null, rows })).toEqual([
      { date: "2026-10-02", amount: 200, balanceAfter: 11_000, afterIndex: 2 },
      { date: "2026-10-04", amount: -500, balanceAfter: 11_500, afterIndex: 4 },
    ]);
  });

  it("모두 맞으면 보정이 없고, 거래가 없거나 거래 후 잔액이 없으면 비교하지 않는다", async () => {
    expect(computeAdjustments({ startBalance: 0, openingDate: null, rows: [row("2026-10-01", 5, 5)] })).toEqual([]);
    expect(computeAdjustments({ startBalance: 0, openingDate: null, rows: [] })).toEqual([]);
    expect(computeAdjustments({ startBalance: 0, openingDate: null, rows: [row("2026-10-01", 5), row("2026-10-02", 5)] })).toEqual([]);
  });

  it("그날 거래 후 잔액이 있는 마지막 거래와 비교하고, 보정은 그날 맨 뒤에 넣는다", async () => {
    const rows = [row("2026-10-01", 100, 1_200), row("2026-10-01", 50)];
    // 계산 1,100(첫 거래까지) → +100, 그 뒤 거래도 그대로 더한다
    expect(computeAdjustments({ startBalance: 1_000, openingDate: null, rows })).toEqual([
      { date: "2026-10-01", amount: 100, balanceAfter: 1_200, afterIndex: 1 },
    ]);
  });

  it("기준일 당일과 이전 날은 비교하지 않고, 그 차이는 기준일 다음 첫 비교 날에 맞춘다", async () => {
    const rows = [
      row("2026-10-09", -100, 900), // 이전: 계산과 상관없이 넘어간다
      row("2026-10-10", -200, 777), // 당일: 기초 잔액에 들어 있다
      row("2026-10-11", 1_000, 2_000), // 계산 10,000 + 1,000 = 11,000 → −9,000
    ];
    expect(computeAdjustments({ startBalance: 10_000, openingDate: "2026-10-10", rows })).toEqual([
      { date: "2026-10-11", amount: -9_000, balanceAfter: 2_000, afterIndex: 2 },
    ]);
    // 기간 전체가 기준일 이전이면 보정이 없다.
    expect(computeAdjustments({ startBalance: 10_000, openingDate: "2026-10-31", rows })).toEqual([]);
  });
});
