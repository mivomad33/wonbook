import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, categories, imports, transactions } from "@/db/schema";
import { getBalances } from "@/lib/balance";
import { buildLines, getAssetOverview, getMonthlyReport, ratioOf } from "@/lib/reports";

async function addAccount(db: Db, userId: number, values: Partial<typeof accounts.$inferInsert> = {}) {
  const [row] = await db
    .insert(accounts)
    .values({ userId, name: "계정", kind: "asset", ...values })
    .returning({ id: accounts.id });
  return row.id;
}

async function addTx(db: Db, userId: number, accountId: number, values: Partial<typeof transactions.$inferInsert> & { amount: number }) {
  await db.insert(transactions).values({ userId, accountId, kind: "normal", source: "upload", date: "2026-09-10", ...values });
}

async function addImport(db: Db, userId: number, accountId: number, periodStart: string, periodEnd: string) {
  await db.insert(imports).values({ userId, accountId, fileName: "f", periodStart, periodEnd, insertedCount: 0, deletedCount: 0 });
}

describe("비율과 정렬(6단계 파일 2장)", () => {
  it("정수 퍼센트로 반올림하고, 0 이하 금액이나 0 이하 합계는 비운다", async () => {
    expect(ratioOf(1, 3)).toBe(33);
    expect(ratioOf(2, 3)).toBe(67);
    expect(ratioOf(1, 200)).toBe(1); // 0.5 → 1
    expect(ratioOf(0, 100)).toBeNull();
    expect(ratioOf(-10, 100)).toBeNull();
    expect(ratioOf(10, -5)).toBeNull();
    expect(ratioOf(10, 0)).toBeNull();
  });

  it("금액이 큰 순이고 미분류는 맨 아래다. 같은 카테고리는 합치고 0인 줄은 뺀다", async () => {
    const lines = buildLines([
      { categoryId: null, name: "", amount: 900 },
      { categoryId: 1, name: "외식", amount: 100 },
      { categoryId: 2, name: "장보기", amount: 300 },
      { categoryId: 1, name: "외식", amount: 100 },
      { categoryId: 3, name: "쇼핑", amount: -100 },
      { categoryId: 4, name: "통신", amount: 0 },
    ]);
    expect(lines.map((l) => [l.name, l.amount, l.ratio])).toEqual([
      ["장보기", 300, 23],
      ["외식", 200, 15],
      ["쇼핑", -100, null],
      ["미분류", 900, 69],
    ]);
  });
});

describe("월별 수입/지출(6단계 파일 1·2장)", () => {
  async function setup() {
    const { db, userId } = await createTestContext();
    const bank = await addAccount(db, userId, { name: "은행" });
    const loan = await addAccount(db, userId, { name: "대출", kind: "liability" });
    const card = await addAccount(db, userId, { name: "카드", kind: "card" });
    // 카테고리 id는 미리 읽어 두고 동기로 꺼낸다.
    const ids = new Map((await db.select().from(categories).where(eq(categories.userId, userId))).map((r) => [r.name, r.id]));
    return { db, userId, bank, loan, card, c: (name: string) => ids.get(name)! };
  }

  it("삭제 표시 거래, 이체, 다른 달 거래는 빠진다", async () => {
    const { db, userId, bank, loan, c } = await setup();
    await addTx(db, userId, bank, { amount: 3_000_000, categoryId: c("급여") });
    await addTx(db, userId, bank, { amount: -50_000, categoryId: c("외식·배달") });
    await addTx(db, userId, bank, { amount: -70_000, categoryId: c("외식·배달"), deletedAt: "2026-09-11T00:00:00Z" });
    await addTx(db, userId, bank, { amount: -300_000, kind: "transfer", source: "manual" });
    await addTx(db, userId, loan, { amount: 300_000, kind: "transfer", source: "manual" });
    await addTx(db, userId, bank, { amount: -9_000, categoryId: c("외식·배달"), date: "2026-08-31" });
    await addTx(db, userId, bank, { amount: -9_000, categoryId: c("외식·배달"), date: "2026-10-01" });

    const { account } = await getMonthlyReport(db, userId, "2026-09");
    expect(account.income).toBe(3_000_000);
    expect(account.expense).toBe(50_000);
    expect(account.expenseByCategory.map((l) => [l.name, l.amount, l.ratio])).toEqual([["외식·배달", 50_000, 100]]);
  });

  it("보정 거래는 합계·구성에 빠지고 보정 건수·합계에만 나온다", async () => {
    const { db, userId, bank, loan, card, c } = await setup();
    await addTx(db, userId, bank, { amount: -10_000, categoryId: c("장보기") });
    await addTx(db, userId, bank, { amount: 59_800_000, kind: "adjustment", source: "system" });
    await addTx(db, userId, loan, { amount: -1_000, kind: "adjustment", source: "system" });
    await addTx(db, userId, bank, { amount: 5_000, kind: "adjustment", source: "system", date: "2026-10-02" });
    // 카드 계정에는 보정이 생기지 않지만, 생겨도 계정 부분 보정에는 넣지 않는다.
    await addTx(db, userId, card, { amount: -7_000, kind: "adjustment", source: "system" });

    const { account, card: cardPart } = await getMonthlyReport(db, userId, "2026-09");
    expect(account.income).toBe(0);
    expect(account.expense).toBe(10_000);
    expect(account.incomeByCategory).toEqual([]);
    expect(account.adjustments).toEqual({ count: 2, total: 59_799_000 });
    expect(cardPart.total).toBe(0);
    expect((await getMonthlyReport(db, userId, "2026-08")).account.adjustments).toEqual({ count: 0, total: 0 });
  });

  it("이동 묶음 거래는 수입·지출에 빠지고 이동 표에 들어옴·나감으로 나온다", async () => {
    const { db, userId, bank, c } = await setup();
    await addTx(db, userId, bank, { amount: 3_000_000, categoryId: c("급여") });
    await addTx(db, userId, bank, { amount: -412_300, categoryId: c("카드대금") });
    await addTx(db, userId, bank, { amount: -200_000, categoryId: c("내 계좌·페이 이동") });
    await addTx(db, userId, bank, { amount: 50_000, categoryId: c("내 계좌·페이 이동") });
    await addTx(db, userId, bank, { amount: -100_000, categoryId: c("개인 송금") });

    const { account } = await getMonthlyReport(db, userId, "2026-09");
    expect(account.income).toBe(3_000_000);
    expect(account.expense).toBe(0);
    expect(account.moves.map((m) => [m.name, m.inflow, m.outflow])).toEqual([
      ["카드대금", 0, 412_300],
      ["내 계좌·페이 이동", 50_000, 200_000],
      ["개인 송금", 0, 100_000],
    ]);
  });

  it("포인트 결제는 다른 결제처럼 카드 사용에 들어간다", async () => {
    const { db, userId, card, c } = await setup();
    await addTx(db, userId, card, { amount: -20_000, categoryId: c("외식·배달") });
    await addTx(db, userId, card, { amount: -5_000, categoryId: c("외식·배달"), method: "포인트리" });

    const { card: part } = await getMonthlyReport(db, userId, "2026-09");
    expect(part).toMatchObject({ total: 25_000, payments: 25_000, refunds: 0 });
    expect(part.byCategory.map((l) => [l.name, l.amount])).toEqual([["외식·배달", 25_000]]);
  });

  it("카드 환불은 같은 카테고리 금액을 줄이고, 환불만 있는 카테고리는 음수이고 비율이 비어 있다", async () => {
    const { db, userId, card, c } = await setup();
    await addTx(db, userId, card, { amount: -129_000, categoryId: c("쇼핑·의류") });
    await addTx(db, userId, card, { amount: 29_000, categoryId: c("쇼핑·의류") });
    await addTx(db, userId, card, { amount: -50_000, categoryId: c("장보기") });
    await addTx(db, userId, card, { amount: 30_000, categoryId: c("여가·여행") });

    const { card: part } = await getMonthlyReport(db, userId, "2026-09");
    expect(part).toMatchObject({ payments: 179_000, refunds: 59_000, total: 120_000 });
    expect(part.byCategory.map((l) => [l.name, l.amount, l.ratio])).toEqual([
      ["쇼핑·의류", 100_000, 83],
      ["장보기", 50_000, 42],
      ["여가·여행", -30_000, null],
    ]);
    expect(part.byCategory.reduce((s, l) => s + l.amount, 0)).toBe(part.total);
  });

  it("계정 부분과 카드 부분이 섞이지 않고, 각 구성의 합이 그 부분 합계와 같다. 미분류는 맨 아래다", async () => {
    const { db, userId, bank, loan, card, c } = await setup();
    await addTx(db, userId, bank, { amount: 3_000_000, categoryId: c("급여") });
    await addTx(db, userId, bank, { amount: 12_000, categoryId: null });
    await addTx(db, userId, bank, { amount: -650_000, categoryId: c("주거·관리비") });
    await addTx(db, userId, bank, { amount: -900_000, categoryId: null });
    await addTx(db, userId, loan, { amount: -30_000, categoryId: c("보험") });
    await addTx(db, userId, card, { amount: -54_200, categoryId: c("장보기") });
    await addTx(db, userId, card, { amount: -32_000, categoryId: null });

    const { account, card: part } = await getMonthlyReport(db, userId, "2026-09");
    expect(account.income).toBe(3_012_000);
    expect(account.expense).toBe(1_580_000);
    expect(account.incomeByCategory.map((l) => l.name)).toEqual(["급여", "미분류"]);
    expect(account.expenseByCategory.map((l) => [l.name, l.amount])).toEqual([
      ["주거·관리비", 650_000],
      ["보험", 30_000],
      ["미분류", 900_000],
    ]);
    expect(account.expenseByCategory.some((l) => l.name === "장보기")).toBe(false);
    expect(part.byCategory.map((l) => [l.name, l.amount, l.categoryId])).toEqual([
      ["장보기", 54_200, c("장보기")],
      ["미분류", 32_000, null],
    ]);
    const sum = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);
    expect(sum(account.incomeByCategory)).toBe(account.income);
    expect(sum(account.expenseByCategory)).toBe(account.expense);
    expect(sum(part.byCategory)).toBe(part.total);
  });
});

describe("자산 현황(6단계 파일 4장)", () => {
  it("자산 합계, 부채 합계(부호 뒤집기), 순자산이 계정 잔액과 맞고 카드 계정은 합계에서 빠진다", async () => {
    const { db, userId } = await createTestContext();
    const bank = await addAccount(db, userId, { name: "은행", openingBalance: 1_000_000, sortOrder: 2 });
    await addAccount(db, userId, { name: "비상금", openingBalance: 5_000_000, sortOrder: 1 });
    const loan = await addAccount(db, userId, { name: "대출", kind: "liability", openingBalance: -8_000_000 });
    const card = await addAccount(db, userId, { name: "카드", kind: "card" });
    await addTx(db, userId, bank, { amount: -200_000 });
    await addTx(db, userId, loan, { amount: 300_000, kind: "transfer", source: "manual" });
    await addTx(db, userId, card, { amount: -99_000 });

    const overview = await getAssetOverview(db, userId);
    expect(overview.assets.map((a) => [a.name, a.balance])).toEqual([
      ["비상금", 5_000_000],
      ["은행", 800_000],
    ]);
    expect(overview.liabilities.map((a) => [a.name, a.balance])).toEqual([["대출", 7_700_000]]);
    expect(overview.cards.map((a) => a.name)).toEqual(["카드"]);
    expect(overview.totals).toEqual({ asset: 5_800_000, liability: 7_700_000, net: -1_900_000 });
    // 순자산은 저장된 잔액(부채는 음수)의 합과 같다.
    const stored = [...(await getBalances(db, userId)).values()].reduce((s, b) => s + b, 0);
    expect(overview.totals.net).toBe(stored);
  });

  it("올린 기간은 가장 늦은 period_end다(늦은 기간을 먼저, 앞 기간을 나중에 올려도)", async () => {
    const { db, userId } = await createTestContext();
    const bank = await addAccount(db, userId, { name: "은행" });
    const card = await addAccount(db, userId, { name: "카드", kind: "card" });
    await addAccount(db, userId, { name: "현금" });
    await addImport(db, userId, bank, "2026-09-01", "2026-10-18");
    await addImport(db, userId, bank, "2026-01-01", "2026-06-30");
    await addImport(db, userId, card, "2026-10-01", "2026-10-10");

    const overview = await getAssetOverview(db, userId);
    expect(overview.assets.map((a) => [a.name, a.lastPeriodEnd])).toEqual([
      ["은행", "2026-10-18"],
      ["현금", null],
    ]);
    expect(overview.cards.map((a) => [a.name, a.lastPeriodEnd])).toEqual([["카드", "2026-10-10"]]);
  });
});
