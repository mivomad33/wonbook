import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
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

type Db = ReturnType<typeof createTestDb>;

function addAccount(db: Db, name: string, kind: "asset" | "liability" | "card" = "asset") {
  return db.insert(accounts).values({ name, kind }).returning({ id: accounts.id }).get().id;
}

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
const row = (db: Db, id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;

describe("수동 거래", () => {
  it("폼에서 고른 카테고리는 user로 붙고, 비우면 미분류가 된다(5단계 파일 2장)", () => {
    const db = createTestDb();
    const a = addAccount(db, "지갑");
    const categoryId = db.select().from(categories).where(eq(categories.name, "장보기")).get()!.id;
    const id = createTransaction(db, tx(a, { categoryId }));
    expect([row(db, id).categoryId, row(db, id).categorySource]).toEqual([categoryId, "user"]);
    updateTransaction(db, id, tx(a, { categoryId: null }));
    expect([row(db, id).categoryId, row(db, id).categorySource]).toEqual([null, null]);
    expect(() => createTransaction(db, tx(a, { categoryId: 9999 }))).toThrow(/카테고리를 찾을 수 없습니다/);
  });

  it("입력하면 kind normal, source manual 거래 1건이 생긴다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const id = createTransaction(db, tx(a));
    expect(row(db, id)).toMatchObject({ accountId: a, kind: "normal", source: "manual", amount: -10_000, editedAt: null });
  });

  it("수동 거래는 계정까지 고칠 수 있고 edited_at은 채우지 않는다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const id = createTransaction(db, tx(a));
    updateTransaction(db, id, tx(b, { amount: 3_000, description: "환불", memo: "메모" }));
    expect(row(db, id)).toMatchObject({ accountId: b, amount: 3_000, description: "환불", memo: "메모", editedAt: null });
  });

  it("업로드 거래를 고치면 edited_at이 채워지고, 계정은 바꿀 수 없다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const id = db
      .insert(transactions)
      .values({ accountId: a, kind: "normal", source: "upload", date: "2026-10-05", amount: -10_000, method: "체크", cardLabel: null })
      .returning({ id: transactions.id })
      .get().id;

    expect(() => updateTransaction(db, id, tx(b))).toThrow(/계정을 바꿀 수 없습니다/);
    expect(row(db, id).editedAt).toBeNull();

    updateTransaction(db, id, tx(a, { amount: -12_000, description: "고친 내용" }));
    const r = row(db, id);
    expect(r).toMatchObject({ source: "upload", amount: -12_000, description: "고친 내용", method: "체크" });
    expect(r.editedAt).not.toBeNull();
  });

  it("삭제 표시하면 목록·잔액에서 빠지고, 되살리면 돌아온다. 업로드 거래의 edited_at은 되살려도 그대로다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const id = createTransaction(db, tx(a));
    const uploaded = db
      .insert(transactions)
      .values({ accountId: a, kind: "normal", source: "upload", date: "2026-10-06", amount: -1_000 })
      .returning({ id: transactions.id })
      .get().id;

    setTransactionDeleted(db, id, true);
    setTransactionDeleted(db, uploaded, true);
    expect(listTransactions(db, all)).toEqual([]);
    expect(getBalance(db, a)).toBe(0);
    expect(listTransactions(db, { ...all, showDeleted: true })).toHaveLength(2);

    setTransactionDeleted(db, id, false);
    setTransactionDeleted(db, uploaded, false);
    expect(getBalance(db, a)).toBe(-11_000);
    expect(row(db, uploaded)).toMatchObject({ deletedAt: null, editedAt: null });
  });

  it("삭제 표시한 거래와 이체는 되살리기 전에는 고칠 수 없다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const id = createTransaction(db, tx(a));
    const [out] = createTransfer(db, transfer(a, b));
    setTransactionDeleted(db, id, true);
    setTransactionDeleted(db, out, true);

    expect(() => updateTransaction(db, id, tx(a, { amount: -1 }))).toThrow("되살린 뒤");
    expect(() => updateTransfer(db, out, transfer(a, b, { amount: 1 }))).toThrow("되살린 뒤");
    expect(row(db, id).amount).toBe(-10_000);
    expect(row(db, out).amount).toBe(-50_000);
  });
  it("보정 거래는 고치거나 삭제 표시할 수 없다(4단계 파일 5장)", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const id = db
      .insert(transactions)
      .values({ accountId: a, kind: "adjustment", source: "system", date: "2026-10-05", amount: 1_000, description: "잔액 보정" })
      .returning({ id: transactions.id })
      .get().id;
    expect(() => updateTransaction(db, id, tx(a))).toThrow("보정 거래");
    expect(() => updateTransfer(db, id, transfer(a, a))).toThrow("보정 거래");
    expect(() => setTransactionDeleted(db, id, true)).toThrow("보정 거래");
    expect(row(db, id)).toMatchObject({ amount: 1_000, editedAt: null, deletedAt: null });
  });
});

describe("이체", () => {
  it("보내는 쪽 −, 받는 쪽 + 거래 2건이 생기고 서로를 가리킨다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const loan = addAccount(db, "빌려준 돈");
    const [out, inn] = createTransfer(db, transfer(a, loan));
    expect(row(db, out)).toMatchObject({ accountId: a, kind: "transfer", source: "manual", amount: -50_000, transferPeerId: inn });
    expect(row(db, inn)).toMatchObject({ accountId: loan, kind: "transfer", source: "manual", amount: 50_000, transferPeerId: out });
    expect(getBalance(db, a)).toBe(-50_000);
    expect(getBalance(db, loan)).toBe(50_000);
  });

  it("카드 계정, 같은 계정, 빈 계정으로는 이체할 수 없다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const card = addAccount(db, "카드", "card");
    expect(() => createTransfer(db, transfer(a, card))).toThrow(/카드 계정/);
    expect(() => createTransfer(db, transfer(a, null))).toThrow(/계정을 고르세요/);
    expect(db.select().from(transactions).all()).toEqual([]);
  });

  it("어느 쪽에서 고쳐도 두 건이 함께 바뀐다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const c = addAccount(db, "c");
    const [out, inn] = createTransfer(db, transfer(a, b));

    // 받는 쪽 행에서 열어 받는 계정과 금액, 내용을 바꾼다.
    updateTransfer(db, inn, transfer(a, c, { amount: 70_000, date: "2026-10-07", description: "바꿈" }));
    expect(row(db, out)).toMatchObject({ accountId: a, amount: -70_000, date: "2026-10-07", description: "바꿈", transferPeerId: inn });
    expect(row(db, inn)).toMatchObject({ accountId: c, amount: 70_000, date: "2026-10-07", description: "바꿈", transferPeerId: out });

    // 보내는 쪽 행에서 열어 방향을 뒤집는다.
    updateTransfer(db, out, transfer(c, a, { amount: 70_000 }));
    expect(row(db, out)).toMatchObject({ accountId: c, amount: -70_000 });
    expect(row(db, inn)).toMatchObject({ accountId: a, amount: 70_000 });
  });

  it("반대쪽이 없으면 남은 한 건만 고친다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const [out] = createTransfer(db, transfer(a, b));
    db.delete(accounts).where(eq(accounts.id, b)).run();
    expect(row(db, out).transferPeerId).toBeNull();

    updateTransfer(db, out, transfer(a, null, { amount: 1_000 }));
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(row(db, out)).toMatchObject({ accountId: a, amount: -1_000 });
  });

  it("삭제 표시와 되살리기를 두 건에 함께 한다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const [out, inn] = createTransfer(db, transfer(a, b));

    setTransactionDeleted(db, inn, true);
    expect(row(db, out).deletedAt).not.toBeNull();
    expect(row(db, inn).deletedAt).not.toBeNull();
    expect(getBalance(db, a)).toBe(0);

    setTransactionDeleted(db, out, false);
    expect(row(db, out).deletedAt).toBeNull();
    expect(row(db, inn).deletedAt).toBeNull();
  });
});

describe("거래 목록", () => {
  it("계정·묶음·월로 거르고, 최신이 위(시각 없는 거래는 같은 날짜의 맨 아래)이며 이체 반대쪽 계정을 함께 준다", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b", "liability");
    const card = addAccount(db, "카드", "card");
    const noTime = createTransaction(db, tx(a, { date: "2026-10-05" }));
    const morning = createTransaction(db, tx(a, { date: "2026-10-05", time: "09:00" }));
    const evening = createTransaction(db, tx(a, { date: "2026-10-05", time: "21:00" }));
    const lastMonth = createTransaction(db, tx(a, { date: "2026-09-30" }));
    const cardTx = createTransaction(db, tx(card, { date: "2026-10-01" }));
    const [out, inn] = createTransfer(db, transfer(a, b, { date: "2026-10-02" }));

    const ids = (f: Partial<TransactionFilter>) => listTransactions(db, { ...all, ...f }).map((r) => r.id);
    expect(ids({})).toEqual([evening, morning, noTime, inn, out, cardTx, lastMonth]);
    expect(ids({ month: "2026-09" })).toEqual([lastMonth]);
    expect(ids({ accountId: b })).toEqual([inn]);
    expect(ids({ group: "card" })).toEqual([cardTx]);
    expect(ids({ group: "account", month: "2026-10" })).toEqual([evening, morning, noTime, inn, out]);

    const outRow = listTransactions(db, { ...all, accountId: a }).find((r) => r.id === out)!;
    expect(outRow).toMatchObject({ accountName: "a", peerAccountId: b, peerAccountName: "b" });
  });

  it("카테고리로 거르고, 미분류는 일반 거래만 본다(5단계 파일 7.1)", () => {
    const db = createTestDb();
    const a = addAccount(db, "a");
    const b = addAccount(db, "b");
    const categoryId = db.select().from(categories).where(eq(categories.name, "장보기")).get()!.id;
    const tagged = createTransaction(db, tx(a, { categoryId }));
    const untagged = createTransaction(db, tx(a));
    createTransfer(db, transfer(a, b));
    const ids = (f: Partial<TransactionFilter>) => listTransactions(db, { ...all, ...f }).map((r) => r.id);
    expect(ids({ categoryId })).toEqual([tagged]);
    expect(ids({ categoryId: "none" })).toEqual([untagged]);
    expect(listTransactions(db, all).find((r) => r.id === tagged)).toMatchObject({ categoryId, categoryName: "장보기" });
  });

  it("요약은 삭제 표시를 빼고 건수, 수입, 지출을 낸다", () => {
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
