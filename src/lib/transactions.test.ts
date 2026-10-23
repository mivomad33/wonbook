import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, categories, transactions } from "@/db/schema";
import { getBalance } from "@/lib/balance";
import type { TransactionFilter } from "@/lib/transaction-filter";
import type { TransactionInput, TransferInput } from "@/lib/transaction-form";
import {
  createTransaction,
  createTransfer,
  listTransactions,
  setTransactionDeleted,
  summarizeTransactions,
  updateTransaction,
  updateTransfer,
} from "@/lib/transactions";

async function addAccount(db: Db, userId: number, name: string, kind: "asset" | "liability" | "card" = "asset") {
  return (await db.insert(accounts).values({ userId, name, kind }).returning({ id: accounts.id }))[0].id;
}

// 테스트용으로 거래를 직접 넣는다(업로드·보정 거래).
async function addRow(db: Db, userId: number, values: Omit<typeof transactions.$inferInsert, "userId">) {
  return (await db.insert(transactions).values({ userId, ...values }).returning({ id: transactions.id }))[0].id;
}

const categoryIdOf = async (db: Db, userId: number, name: string) =>
  (await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.name, name))))[0].id;

const tx = (accountId: number, extra: Partial<TransactionInput> = {}): TransactionInput => ({
  accountId,
  date: "2026-10-05",
  time: null,
  amount: -10_000,
  description: "편의점",
  memo: null,
  ...extra,
});

const transfer = (fromAccountId: number | null, toAccountId: number | null, extra: Partial<TransferInput> = {}): TransferInput => ({
  fromAccountId,
  toAccountId,
  date: "2026-10-05",
  time: null,
  amount: 50_000,
  description: "빌려줌",
  memo: null,
  ...extra,
});

const all: TransactionFilter = { accountId: null, group: null, month: "all", categoryId: null, showDeleted: false };
const row = async (db: Db, userId: number, id: number) =>
  (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id))))[0];

describe("수동 거래", () => {
  it("폼에서 고른 카테고리는 user로 붙고, 비우면 미분류가 된다(5단계 파일 2장)", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "지갑");
    const categoryId = await categoryIdOf(db, userId, "장보기");
    const id = await createTransaction(db, userId, tx(a, { categoryId }));
    expect([(await row(db, userId, id)).categoryId, (await row(db, userId, id)).categorySource]).toEqual([categoryId, "user"]);
    await updateTransaction(db, userId, id, tx(a, { categoryId: null }));
    expect([(await row(db, userId, id)).categoryId, (await row(db, userId, id)).categorySource]).toEqual([null, null]);
    await expect(createTransaction(db, userId, tx(a, { categoryId: 9999 }))).rejects.toThrow(/카테고리를 찾을 수 없습니다/);
  });

  it("입력하면 kind normal, source manual 거래 1건이 생긴다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const id = await createTransaction(db, userId, tx(a));
    expect(await row(db, userId, id)).toMatchObject({ accountId: a, kind: "normal", source: "manual", amount: -10_000, editedAt: null });
  });

  it("수동 거래는 계정까지 고칠 수 있고 edited_at은 채우지 않는다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const id = await createTransaction(db, userId, tx(a));
    await updateTransaction(db, userId, id, tx(b, { amount: 3_000, description: "환불", memo: "메모" }));
    expect(await row(db, userId, id)).toMatchObject({ accountId: b, amount: 3_000, description: "환불", memo: "메모", editedAt: null });
  });

  it("업로드 거래를 고치면 edited_at이 채워지고, 계정은 바꿀 수 없다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const id = await addRow(db, userId, { accountId: a, kind: "normal", source: "upload", date: "2026-10-05", amount: -10_000, method: "체크", cardLabel: null });

    await expect(updateTransaction(db, userId, id, tx(b))).rejects.toThrow(/계정을 바꿀 수 없습니다/);
    expect((await row(db, userId, id)).editedAt).toBeNull();

    await updateTransaction(db, userId, id, tx(a, { amount: -12_000, description: "고친 내용" }));
    const r = await row(db, userId, id);
    expect(r).toMatchObject({ source: "upload", amount: -12_000, description: "고친 내용", method: "체크" });
    expect(r.editedAt).not.toBeNull();
  });

  it("삭제 표시하면 목록·잔액에서 빠지고, 되살리면 돌아온다. 업로드 거래의 edited_at은 되살려도 그대로다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const id = await createTransaction(db, userId, tx(a));
    const uploaded = await addRow(db, userId, { accountId: a, kind: "normal", source: "upload", date: "2026-10-06", amount: -1_000 });

    await setTransactionDeleted(db, userId, id, true);
    await setTransactionDeleted(db, userId, uploaded, true);
    expect(await listTransactions(db, userId, all)).toEqual([]);
    expect(await getBalance(db, userId, a)).toBe(0);
    expect(await listTransactions(db, userId, { ...all, showDeleted: true })).toHaveLength(2);

    await setTransactionDeleted(db, userId, id, false);
    await setTransactionDeleted(db, userId, uploaded, false);
    expect(await getBalance(db, userId, a)).toBe(-11_000);
    expect(await row(db, userId, uploaded)).toMatchObject({ deletedAt: null, editedAt: null });
  });

  it("삭제 표시한 거래와 이체는 되살리기 전에는 고칠 수 없다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const id = await createTransaction(db, userId, tx(a));
    const [out] = await createTransfer(db, userId, transfer(a, b));
    await setTransactionDeleted(db, userId, id, true);
    await setTransactionDeleted(db, userId, out, true);

    await expect(updateTransaction(db, userId, id, tx(a, { amount: -1 }))).rejects.toThrow("되살린 뒤");
    await expect(updateTransfer(db, userId, out, transfer(a, b, { amount: 1 }))).rejects.toThrow("되살린 뒤");
    expect((await row(db, userId, id)).amount).toBe(-10_000);
    expect((await row(db, userId, out)).amount).toBe(-50_000);
  });
  it("보정 거래는 고치거나 삭제 표시할 수 없다(4단계 파일 5장)", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const id = await addRow(db, userId, { accountId: a, kind: "adjustment", source: "system", date: "2026-10-05", amount: 1_000, description: "잔액 보정" });
    await expect(updateTransaction(db, userId, id, tx(a))).rejects.toThrow("보정 거래");
    await expect(updateTransfer(db, userId, id, transfer(a, a))).rejects.toThrow("보정 거래");
    await expect(setTransactionDeleted(db, userId, id, true)).rejects.toThrow("보정 거래");
    expect(await row(db, userId, id)).toMatchObject({ amount: 1_000, editedAt: null, deletedAt: null });
  });
});

describe("이체", () => {
  it("보내는 쪽 −, 받는 쪽 + 거래 2건이 생기고 서로를 가리킨다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const loan = await addAccount(db, userId, "빌려준 돈");
    const [out, inn] = await createTransfer(db, userId, transfer(a, loan));
    expect(await row(db, userId, out)).toMatchObject({ accountId: a, kind: "transfer", source: "manual", amount: -50_000, transferPeerId: inn });
    expect(await row(db, userId, inn)).toMatchObject({ accountId: loan, kind: "transfer", source: "manual", amount: 50_000, transferPeerId: out });
    expect(await getBalance(db, userId, a)).toBe(-50_000);
    expect(await getBalance(db, userId, loan)).toBe(50_000);
  });

  it("카드 계정, 같은 계정, 빈 계정으로는 이체할 수 없다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const card = await addAccount(db, userId, "카드", "card");
    await expect(createTransfer(db, userId, transfer(a, card))).rejects.toThrow(/카드 계정/);
    await expect(createTransfer(db, userId, transfer(a, null))).rejects.toThrow(/계정을 고르세요/);
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it("어느 쪽에서 고쳐도 두 건이 함께 바뀐다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const c = await addAccount(db, userId, "c");
    const [out, inn] = await createTransfer(db, userId, transfer(a, b));

    // 받는 쪽 행에서 열어 받는 계정과 금액, 내용을 바꾼다.
    await updateTransfer(db, userId, inn, transfer(a, c, { amount: 70_000, date: "2026-10-07", description: "바꿈" }));
    expect(await row(db, userId, out)).toMatchObject({ accountId: a, amount: -70_000, date: "2026-10-07", description: "바꿈", transferPeerId: inn });
    expect(await row(db, userId, inn)).toMatchObject({ accountId: c, amount: 70_000, date: "2026-10-07", description: "바꿈", transferPeerId: out });

    // 보내는 쪽 행에서 열어 방향을 뒤집는다.
    await updateTransfer(db, userId, out, transfer(c, a, { amount: 70_000 }));
    expect(await row(db, userId, out)).toMatchObject({ accountId: c, amount: -70_000 });
    expect(await row(db, userId, inn)).toMatchObject({ accountId: a, amount: 70_000 });
  });

  it("반대쪽이 없으면 남은 한 건만 고친다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const [out] = await createTransfer(db, userId, transfer(a, b));
    await db.delete(accounts).where(eq(accounts.id, b));
    expect((await row(db, userId, out)).transferPeerId).toBeNull();

    await updateTransfer(db, userId, out, transfer(a, null, { amount: 1_000 }));
    expect(await db.select().from(transactions)).toHaveLength(1);
    expect(await row(db, userId, out)).toMatchObject({ accountId: a, amount: -1_000 });
  });

  it("삭제 표시와 되살리기를 두 건에 함께 한다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const [out, inn] = await createTransfer(db, userId, transfer(a, b));

    await setTransactionDeleted(db, userId, inn, true);
    expect((await row(db, userId, out)).deletedAt).not.toBeNull();
    expect((await row(db, userId, inn)).deletedAt).not.toBeNull();
    expect(await getBalance(db, userId, a)).toBe(0);

    await setTransactionDeleted(db, userId, out, false);
    expect((await row(db, userId, out)).deletedAt).toBeNull();
    expect((await row(db, userId, inn)).deletedAt).toBeNull();
  });
});

describe("거래 목록", () => {
  it("계정·묶음·월로 거르고, 최신이 위(시각 없는 거래는 같은 날짜의 맨 아래)이며 이체 반대쪽 계정을 함께 준다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b", "liability");
    const card = await addAccount(db, userId, "카드", "card");
    const noTime = await createTransaction(db, userId, tx(a, { date: "2026-10-05" }));
    const morning = await createTransaction(db, userId, tx(a, { date: "2026-10-05", time: "09:00" }));
    const evening = await createTransaction(db, userId, tx(a, { date: "2026-10-05", time: "21:00" }));
    const lastMonth = await createTransaction(db, userId, tx(a, { date: "2026-09-30" }));
    const cardTx = await createTransaction(db, userId, tx(card, { date: "2026-10-01" }));
    const [out, inn] = await createTransfer(db, userId, transfer(a, b, { date: "2026-10-02" }));

    const ids = async (f: Partial<TransactionFilter>) => (await listTransactions(db, userId, { ...all, ...f })).map((r) => r.id);
    expect(await ids({})).toEqual([evening, morning, noTime, inn, out, cardTx, lastMonth]);
    expect(await ids({ month: "2026-09" })).toEqual([lastMonth]);
    expect(await ids({ accountId: b })).toEqual([inn]);
    expect(await ids({ group: "card" })).toEqual([cardTx]);
    expect(await ids({ group: "account", month: "2026-10" })).toEqual([evening, morning, noTime, inn, out]);

    const outRow = (await listTransactions(db, userId, { ...all, accountId: a })).find((r) => r.id === out)!;
    expect(outRow).toMatchObject({ accountName: "a", peerAccountId: b, peerAccountName: "b" });
  });

  it("카테고리로 거르고, 미분류는 일반 거래만 본다(5단계 파일 7.1)", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "a");
    const b = await addAccount(db, userId, "b");
    const categoryId = await categoryIdOf(db, userId, "장보기");
    const tagged = await createTransaction(db, userId, tx(a, { categoryId }));
    const untagged = await createTransaction(db, userId, tx(a));
    await createTransfer(db, userId, transfer(a, b));
    const ids = async (f: Partial<TransactionFilter>) => (await listTransactions(db, userId, { ...all, ...f })).map((r) => r.id);
    expect(await ids({ categoryId })).toEqual([tagged]);
    expect(await ids({ categoryId: "none" })).toEqual([untagged]);
    expect((await listTransactions(db, userId, all)).find((r) => r.id === tagged)).toMatchObject({ categoryId, categoryName: "장보기" });
  });

  it("요약은 삭제 표시를 빼고 건수, 수입, 지출을 낸다", async () => {
    expect(
      summarizeTransactions([
        { amount: 1_000, deletedAt: null },
        { amount: -300, deletedAt: null },
        { amount: -200, deletedAt: null },
        { amount: 5_000, deletedAt: "2026-10-19T00:00:00.000Z" },
      ]),
    ).toEqual({ count: 3, income: 1_000, expense: 500 });
  });
});
