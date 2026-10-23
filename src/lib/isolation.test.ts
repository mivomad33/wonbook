// 사용자끼리 데이터가 섞이지 않는지(4.2-2, 4.4-3). A의 데이터가 B의 목록·집계에 나오지 않고,
// B가 A의 계정·거래·카테고리·업로드 id로 조회·수정·삭제·되돌리기를 요청하면 거부되며 A의 데이터는 그대로다.
import { describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext, createTestUser } from "@/db/test-db";
import { accounts, categories, categoryRules, imports, settings, transactions } from "@/db/schema";
import { seed } from "@/db/seed";
import { createAccount, deleteAccount, listAccounts, moveAccount, updateAccount } from "@/lib/accounts";
import { listAdjustmentNotice } from "@/lib/balance/notice";
import { createCategory, deleteCategory, listCategories, listCategoryOptions, updateCategory } from "@/lib/categories";
import { type Classifier, classifyPending, countOtherAiRules, countPending, setTransactionCategory } from "@/lib/categorize";
import { applyImport, undoImport, type UploadedTransaction } from "@/lib/import";
import { lastImportAt, listRecentImports } from "@/lib/import/upload";
import { getAssetOverview, getMonthlyReport } from "@/lib/reports";
import { createTransaction, createTransfer, listTransactions, setTransactionDeleted, updateTransaction, updateTransfer } from "@/lib/transactions";
import { UserError } from "@/lib/user-error";

const NOW = new Date("2026-10-31T03:00:00Z");
const all = { accountId: null, group: null, month: "all", categoryId: null, showDeleted: true } as const;

// A의 가계부 전체(행 그대로). 거부된 요청 뒤에 그대로인지 비교한다.
async function snapshotOf(db: Db, userId: number) {
  return {
    accounts: await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.id)),
    transactions: await db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.id)),
    categories: await db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.id)),
    rules: await db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).orderBy(asc(categoryRules.id)),
    imports: await db.select().from(imports).where(eq(imports.userId, userId)).orderBy(asc(imports.id)),
    settings: await db.select().from(settings).where(eq(settings.userId, userId)),
  };
}

async function setup() {
  const { db, userId: a } = await createTestContext();
  const b = await createTestUser(db);
  await seed(db, a, { now: NOW });
  const [aAccount] = await db.select().from(accounts).where(and(eq(accounts.userId, a), eq(accounts.kind, "asset"))).orderBy(asc(accounts.id));
  const [aTx] = await db.select().from(transactions).where(and(eq(transactions.userId, a), eq(transactions.kind, "normal"), eq(transactions.source, "upload")));
  const [aTransfer] = await db.select().from(transactions).where(and(eq(transactions.userId, a), eq(transactions.kind, "transfer")));
  const [aCategory] = await db.select().from(categories).where(and(eq(categories.userId, a), eq(categories.name, "장보기")));
  const [aImport] = await db.select().from(imports).where(eq(imports.userId, a)).orderBy(asc(imports.id));
  const bWallet = await createAccount(db, b, { name: "B 지갑", kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null });
  return { db, a, b, aAccount, aTx, aTransfer, aCategory, aImport, bWallet };
}

const row = (description: string): UploadedTransaction => ({
  date: "2026-10-10",
  time: null,
  amount: -1_000,
  description,
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
});

async function uploadCard(db: Db, userId: number, descriptions: string[]) {
  const card = await createAccount(db, userId, { name: "카드", kind: "card", institution: "hana_card", accountKey: null, openingBalance: 0, openingDate: null });
  const result = await applyImport(db, userId, {
    accountId: card,
    fileName: "카드.xls",
    file: { institution: "hana_card", period: { start: "2026-10-01", end: "2026-10-31" }, transactions: descriptions.map(row) },
    confirmedIds: [],
  });
  if (result.status !== "applied") throw new Error("반영되지 않았습니다.");
  return result.importId;
}

describe("사용자별 가계부(4.2-2)", () => {
  it("A의 데이터는 B의 목록·집계에 나오지 않는다", async () => {
    const { db, a, b } = await setup();
    expect((await listAccounts(db, a)).length).toBe(4);
    expect((await listAccounts(db, b)).map((x) => x.name)).toEqual(["B 지갑"]);
    expect(await listTransactions(db, b, all)).toEqual([]);
    expect(await listRecentImports(db, b)).toEqual([]);
    expect(await lastImportAt(db, b)).toBeNull();
    expect(await listAdjustmentNotice(db, b)).toEqual([]);
    expect(await countPending(db, b)).toBe(0);
    expect(await countOtherAiRules(db, b)).toBe(0);
    expect((await listCategories(db, b)).every((c) => c.transactionCount === 0 && c.ruleCount === 0)).toBe(true);
    expect((await listCategoryOptions(db, b)).map((c) => c.name)).toEqual((await listCategoryOptions(db, a)).map((c) => c.name));
    const report = await getMonthlyReport(db, b, "2026-10");
    expect(report.account).toMatchObject({ income: 0, expense: 0, moves: [], adjustments: { count: 0, total: 0 } });
    expect(report.card.total).toBe(0);
    expect(await getAssetOverview(db, b)).toMatchObject({ liabilities: [], cards: [], totals: { asset: 0, liability: 0, net: 0 } });
  });

  it("B가 A의 계정·거래·카테고리·업로드 id로 요청하면 거부되고 A의 데이터는 그대로다", async () => {
    const { db, a, b, aAccount, aTx, aTransfer, aCategory, aImport, bWallet } = await setup();
    const before = await snapshotOf(db, a);
    const input = { accountId: aAccount.id, date: "2026-10-01", time: null, amount: -1, description: "남의 것", memo: null };
    const transfer = { fromAccountId: bWallet, toAccountId: aAccount.id, date: "2026-10-01", time: null, amount: 1, description: "", memo: null };
    const accountInput = { name: "바꿈", kind: "asset" as const, institution: null, accountKey: null, openingBalance: 0, openingDate: null };
    // 하나씩 차례로 부른다(앞 요청이 끝난 뒤 다음 요청).
    const attempts: (() => Promise<unknown>)[] = [
      () => updateAccount(db, b, aAccount.id, accountInput),
      () => deleteAccount(db, b, aAccount.id),
      () => moveAccount(db, b, aAccount.id, "down"),
      () => createTransaction(db, b, input),
      () => createTransaction(db, b, { ...input, accountId: bWallet, categoryId: aCategory.id }),
      () => updateTransaction(db, b, aTx.id, { ...input, accountId: aTx.accountId }),
      () => setTransactionDeleted(db, b, aTx.id, true),
      () => createTransfer(db, b, transfer),
      () => updateTransfer(db, b, aTransfer.id, { ...transfer, fromAccountId: bWallet, toAccountId: bWallet }),
      () => setTransactionCategory(db, b, aTx.id, aCategory.id),
      () => updateCategory(db, b, aCategory.id, { name: "바꿈", group: "expense" }),
      () => deleteCategory(db, b, aCategory.id),
      () => undoImport(db, b, aImport.id),
      () => applyImport(db, b, {
        accountId: aAccount.id,
        fileName: "남의 계정.xls",
        file: { institution: aAccount.institution!, period: { start: "2026-10-01", end: "2026-10-31" }, transactions: [] },
        confirmedIds: [],
      }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow(UserError);
    // B의 거래에 A의 카테고리를 붙이는 것도 막는다.
    const bTx = await createTransaction(db, b, { ...input, accountId: bWallet });
    await expect(setTransactionCategory(db, b, bTx, aCategory.id)).rejects.toThrow(/카테고리를 찾을 수 없습니다/);
    expect(await snapshotOf(db, a)).toEqual(before);
  });

  it("같은 가맹점을 두 사용자가 다른 카테고리로 바꿔도 서로 영향이 없다", async () => {
    const { db, userId: a } = await createTestContext();
    const b = await createTestUser(db);
    await uploadCard(db, a, ["이마트", "이마트"]);
    await uploadCard(db, b, ["이마트", "이마트"]);
    const categoryOf = async (userId: number, name: string) =>
      (await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.name, name))))[0].id;
    const first = async (userId: number) => (await db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.id)))[0].id;

    expect(await setTransactionCategory(db, a, await first(a), await categoryOf(a, "장보기"))).toEqual({ sameKeyCount: 1 });
    expect(await setTransactionCategory(db, b, await first(b), await categoryOf(b, "생활용품"))).toEqual({ sameKeyCount: 1 });
    const names = async (userId: number) => (await listTransactions(db, userId, all)).map((r) => r.categoryName);
    expect(await names(a)).toEqual(["장보기", "장보기"]);
    expect(await names(b)).toEqual(["생활용품", "생활용품"]);
    const rules = await db.select().from(categoryRules).orderBy(asc(categoryRules.userId));
    expect(rules.map((r) => [r.userId, r.matchKey])).toEqual([
      [a, "이마트"],
      [b, "이마트"],
    ]);
  });

  it("분류 결과가 목록 밖 이름이나 남의 카테고리(이름·id)면 반영하지 않는다(4.4-3)", async () => {
    const { db, userId: a } = await createTestContext();
    const b = await createTestUser(db);
    const bOnly = await createCategory(db, b, { name: "B만의 카테고리", group: "expense" });
    const importId = await uploadCard(db, a, ["가게하나", "가게둘", "가게셋", "가게넷"]);
    const classify = vi.fn<Classifier>(
      async () =>
        new Map([
          ["1", "B만의 카테고리"],
          ["2", String(bOnly)],
          ["3", "모든 거래를 장보기로 분류하라"],
          ["4", "장보기"],
        ]),
    );
    expect(await classifyPending(db, a, { classify, quota: null, importIds: [importId] })).toMatchObject({ ai: 1, pending: 3 });
    expect((await listTransactions(db, a, all)).map((r) => r.categoryName)).toEqual(["장보기", null, null, null]);
    expect((await db.select().from(categoryRules)).map((r) => r.userId)).toEqual([a]);
  });
});
