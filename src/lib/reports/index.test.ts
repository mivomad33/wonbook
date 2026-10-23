import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, categories, imports, transactions } from "@/db/schema";
import { getBalances } from "@/lib/balance";
import { buildLines, getAssetOverview, getMonthlyReport, ratioOf } from "@/lib/reports";

type Db = ReturnType<typeof createTestDb>;

function addAccount(db: Db, values: Partial<typeof accounts.$inferInsert> = {}) {
  return db
    .insert(accounts)
    .values({ name: "계정", kind: "asset", ...values })
    .returning({ id: accounts.id })
    .get().id;
}

function categoryId(db: Db, name: string) {
  return db.select({ id: categories.id }).from(categories).where(eq(categories.name, name)).get()!.id;
}

function addTx(db: Db, accountId: number, values: Partial<typeof transactions.$inferInsert> & { amount: number }) {
  db.insert(transactions)
    .values({ accountId, kind: "normal", source: "upload", date: "2026-09-10", ...values })
    .run();
}

function addImport(db: Db, accountId: number, periodStart: string, periodEnd: string) {
  db.insert(imports).values({ accountId, fileName: "f", periodStart, periodEnd, insertedCount: 0, deletedCount: 0 }).run();
}

describe("비율과 정렬(6단계 파일 2장)", () => {
  it("정수 퍼센트로 반올림하고, 0 이하 금액이나 0 이하 합계는 비운다", () => {
    expect(ratioOf(1, 3)).toBe(33);
    expect(ratioOf(2, 3)).toBe(67);
    expect(ratioOf(1, 200)).toBe(1); // 0.5 → 1
    expect(ratioOf(0, 100)).toBeNull();
    expect(ratioOf(-10, 100)).toBeNull();
    expect(ratioOf(10, -5)).toBeNull();
    expect(ratioOf(10, 0)).toBeNull();
  });

  it("금액이 큰 순이고 미분류는 맨 아래다. 같은 카테고리는 합치고 0인 줄은 뺀다", () => {
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
  function setup() {
    const db = createTestDb();
    const bank = addAccount(db, { name: "은행" });
    const loan = addAccount(db, { name: "대출", kind: "liability" });
    const card = addAccount(db, { name: "카드", kind: "card" });
    return { db, bank, loan, card, c: (name: string) => categoryId(db, name) };
  }

  it("삭제 표시 거래, 이체, 다른 달 거래는 빠진다", () => {
    const { db, bank, loan, c } = setup();
    addTx(db, bank, { amount: 3_000_000, categoryId: c("급여") });
    addTx(db, bank, { amount: -50_000, categoryId: c("외식·배달") });
    addTx(db, bank, { amount: -70_000, categoryId: c("외식·배달"), deletedAt: "2026-09-11T00:00:00Z" });
    addTx(db, bank, { amount: -300_000, kind: "transfer", source: "manual" });
    addTx(db, loan, { amount: 300_000, kind: "transfer", source: "manual" });
    addTx(db, bank, { amount: -9_000, categoryId: c("외식·배달"), date: "2026-08-31" });
    addTx(db, bank, { amount: -9_000, categoryId: c("외식·배달"), date: "2026-10-01" });

    const { account } = getMonthlyReport(db, "2026-09");
    expect(account.income).toBe(3_000_000);
    expect(account.expense).toBe(50_000);
    expect(account.expenseByCategory.map((l) => [l.name, l.amount, l.ratio])).toEqual([["외식·배달", 50_000, 100]]);
  });

  it("보정 거래는 합계·구성에 빠지고 보정 건수·합계에만 나온다", () => {
    const { db, bank, loan, card, c } = setup();
    addTx(db, bank, { amount: -10_000, categoryId: c("장보기") });
    addTx(db, bank, { amount: 59_800_000, kind: "adjustment", source: "system" });
    addTx(db, loan, { amount: -1_000, kind: "adjustment", source: "system" });
    addTx(db, bank, { amount: 5_000, kind: "adjustment", source: "system", date: "2026-10-02" });
    // 카드 계정에는 보정이 생기지 않지만, 생겨도 계정 부분 보정에는 넣지 않는다.
    addTx(db, card, { amount: -7_000, kind: "adjustment", source: "system" });

    const { account, card: cardPart } = getMonthlyReport(db, "2026-09");
    expect(account.income).toBe(0);
    expect(account.expense).toBe(10_000);
    expect(account.incomeByCategory).toEqual([]);
    expect(account.adjustments).toEqual({ count: 2, total: 59_799_000 });
    expect(cardPart.total).toBe(0);
    expect(getMonthlyReport(db, "2026-08").account.adjustments).toEqual({ count: 0, total: 0 });
  });

  it("이동 묶음 거래는 수입·지출에 빠지고 이동 표에 들어옴·나감으로 나온다", () => {
    const { db, bank, c } = setup();
    addTx(db, bank, { amount: 3_000_000, categoryId: c("급여") });
    addTx(db, bank, { amount: -412_300, categoryId: c("카드대금") });
    addTx(db, bank, { amount: -200_000, categoryId: c("내 계좌·페이 이동") });
    addTx(db, bank, { amount: 50_000, categoryId: c("내 계좌·페이 이동") });
    addTx(db, bank, { amount: -100_000, categoryId: c("개인 송금") });

    const { account } = getMonthlyReport(db, "2026-09");
    expect(account.income).toBe(3_000_000);
    expect(account.expense).toBe(0);
    expect(account.moves.map((m) => [m.name, m.inflow, m.outflow])).toEqual([
      ["카드대금", 0, 412_300],
      ["내 계좌·페이 이동", 50_000, 200_000],
      ["개인 송금", 0, 100_000],
    ]);
  });

  it("포인트 결제는 다른 결제처럼 카드 사용에 들어간다", () => {
    const { db, card, c } = setup();
    addTx(db, card, { amount: -20_000, categoryId: c("외식·배달") });
    addTx(db, card, { amount: -5_000, categoryId: c("외식·배달"), method: "포인트리" });

    const { card: part } = getMonthlyReport(db, "2026-09");
    expect(part).toMatchObject({ total: 25_000, payments: 25_000, refunds: 0 });
    expect(part.byCategory.map((l) => [l.name, l.amount])).toEqual([["외식·배달", 25_000]]);
  });

  it("카드 환불은 같은 카테고리 금액을 줄이고, 환불만 있는 카테고리는 음수이고 비율이 비어 있다", () => {
    const { db, card, c } = setup();
    addTx(db, card, { amount: -129_000, categoryId: c("쇼핑·의류") });
    addTx(db, card, { amount: 29_000, categoryId: c("쇼핑·의류") });
    addTx(db, card, { amount: -50_000, categoryId: c("장보기") });
    addTx(db, card, { amount: 30_000, categoryId: c("여가·여행") });

    const { card: part } = getMonthlyReport(db, "2026-09");
    expect(part).toMatchObject({ payments: 179_000, refunds: 59_000, total: 120_000 });
    expect(part.byCategory.map((l) => [l.name, l.amount, l.ratio])).toEqual([
      ["쇼핑·의류", 100_000, 83],
      ["장보기", 50_000, 42],
      ["여가·여행", -30_000, null],
    ]);
    expect(part.byCategory.reduce((s, l) => s + l.amount, 0)).toBe(part.total);
  });

  it("계정 부분과 카드 부분이 섞이지 않고, 각 구성의 합이 그 부분 합계와 같다. 미분류는 맨 아래다", () => {
    const { db, bank, loan, card, c } = setup();
    addTx(db, bank, { amount: 3_000_000, categoryId: c("급여") });
    addTx(db, bank, { amount: 12_000, categoryId: null });
    addTx(db, bank, { amount: -650_000, categoryId: c("주거·관리비") });
    addTx(db, bank, { amount: -900_000, categoryId: null });
    addTx(db, loan, { amount: -30_000, categoryId: c("보험") });
    addTx(db, card, { amount: -54_200, categoryId: c("장보기") });
    addTx(db, card, { amount: -32_000, categoryId: null });

    const { account, card: part } = getMonthlyReport(db, "2026-09");
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
  it("자산 합계, 부채 합계(부호 뒤집기), 순자산이 계정 잔액과 맞고 카드 계정은 합계에서 빠진다", () => {
    const db = createTestDb();
    const bank = addAccount(db, { name: "은행", openingBalance: 1_000_000, sortOrder: 2 });
    addAccount(db, { name: "비상금", openingBalance: 5_000_000, sortOrder: 1 });
    const loan = addAccount(db, { name: "대출", kind: "liability", openingBalance: -8_000_000 });
    const card = addAccount(db, { name: "카드", kind: "card" });
    addTx(db, bank, { amount: -200_000 });
    addTx(db, loan, { amount: 300_000, kind: "transfer", source: "manual" });
    addTx(db, card, { amount: -99_000 });

    const overview = getAssetOverview(db);
    expect(overview.assets.map((a) => [a.name, a.balance])).toEqual([
      ["비상금", 5_000_000],
      ["은행", 800_000],
    ]);
    expect(overview.liabilities.map((a) => [a.name, a.balance])).toEqual([["대출", 7_700_000]]);
    expect(overview.cards.map((a) => a.name)).toEqual(["카드"]);
    expect(overview.totals).toEqual({ asset: 5_800_000, liability: 7_700_000, net: -1_900_000 });
    // 순자산은 저장된 잔액(부채는 음수)의 합과 같다.
    const stored = [...getBalances(db).values()].reduce((s, b) => s + b, 0);
    expect(overview.totals.net).toBe(stored);
  });

  it("올린 기간은 가장 늦은 period_end다(늦은 기간을 먼저, 앞 기간을 나중에 올려도)", () => {
    const db = createTestDb();
    const bank = addAccount(db, { name: "은행" });
    const card = addAccount(db, { name: "카드", kind: "card" });
    addAccount(db, { name: "현금" });
    addImport(db, bank, "2026-09-01", "2026-10-18");
    addImport(db, bank, "2026-01-01", "2026-06-30");
    addImport(db, card, "2026-10-01", "2026-10-10");

    const overview = getAssetOverview(db);
    expect(overview.assets.map((a) => [a.name, a.lastPeriodEnd])).toEqual([
      ["은행", "2026-10-18"],
      ["현금", null],
    ]);
    expect(overview.cards.map((a) => [a.name, a.lastPeriodEnd])).toEqual([["카드", "2026-10-10"]]);
  });
});
