import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, categories, importUndo, imports, transactions } from "@/db/schema";
import { createAccount } from "@/lib/accounts";
import { getBalance } from "@/lib/balance";
import { setTransactionCategory } from "@/lib/categorize";
import { applyImport, type ImportData, undoImport, type UploadedTransaction } from "@/lib/import";
import { listRecentImports } from "@/lib/import/upload";
import { toAccountKeyRef } from "@/lib/privacy/account-key";
import { createTransaction, createTransfer, setTransactionDeleted, updateTransaction } from "@/lib/transactions";

const tx = (date: string, amount: number, balanceAfter: number | null = null, description = "파일 거래"): UploadedTransaction => ({
  date,
  time: null,
  amount,
  description,
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter,
});

const file = (rows: UploadedTransaction[], start = "2026-10-01", end = "2026-10-31"): ImportData => ({
  institution: "hana_bank",
  period: { start, end },
  transactions: rows,
});

async function setup() {
  const { db, userId } = await createTestContext();
  const bank = await createAccount(db, userId, {
    name: "하나",
    kind: "asset",
    institution: "hana_bank",
    accountKey: await toAccountKeyRef("hana_bank", "111-222222-33333"),
    openingBalance: 0,
    openingDate: null,
  });
  const [{ id: wallet }] = await db.insert(accounts).values({ userId, name: "지갑", kind: "asset" }).returning();
  const upload = async (data: ImportData, confirmedIds: number[] = []) => {
    const result = await applyImport(db, userId, { accountId: bank, fileName: "하나.xls", file: data, confirmedIds });
    if (result.status !== "applied") throw new Error("반영되지 않았습니다.");
    return result.importId;
  };
  return { db, userId, bank, wallet, upload };
}

// 비교할 거래 상태(만든 시각 포함 모든 칸)
const snapshot = (db: Db, userId: number) =>
  db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.id));

describe("업로드 되돌리기(4.3-5)", () => {
  it("겹치는 기간 파일을 올린 뒤 되돌리면 거래 목록·잔액·보정 거래·손댄 표시·카테고리·이체 연결이 올리기 전과 같다", async () => {
    const { db, userId, bank, wallet, upload } = await setup();
    // 9~10월 파일. 9월 5일에 실제 잔액이 500 커서 보정이 생긴다.
    await upload(file([tx("2026-09-05", 1_000, 1_500, "이마트"), tx("2026-10-03", -200, 1_300, "스타벅스")], "2026-09-01", "2026-10-31"));
    const [mart] = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.description, "이마트")));
    // 업로드 거래를 고치고, 카테고리를 붙이고, 삭제 표시를 하고, 이체를 넣는다.
    const [shop] = await db.select().from(transactions).where(eq(transactions.description, "스타벅스"));
    await updateTransaction(db, userId, mart.id, { accountId: bank, date: "2026-09-05", time: null, amount: 1_000, description: "이마트 장보기", memo: "고침" });
    await setTransactionCategory(db, userId, shop.id, await categoryIdOf(db, userId, "카페·간식"));
    await setTransactionDeleted(db, userId, shop.id, true);
    await setTransactionDeleted(db, userId, shop.id, false);
    const [out, inn] = await createTransfer(db, userId, { fromAccountId: bank, toAccountId: wallet, date: "2026-10-10", time: null, amount: 300, description: "현금 찾음", memo: null });
    const before = await snapshot(db, userId);
    const balanceBefore = await getBalance(db, userId, bank);
    expect(before.filter((r) => r.kind === "adjustment")).toHaveLength(1);

    // 10월 파일(겹치는 기간)을 확인받고 올린다. 이체 한쪽과 고친 거래가 없는 기간이라 이체·스타벅스만 지워진다.
    const importId = await upload(file([tx("2026-10-03", -200, 9_999, "스타벅스"), tx("2026-10-20", 50, 10_049, "이자")]), [out]);
    expect((await snapshot(db, userId)).find((r) => r.id === inn)?.transferPeerId).toBeNull();
    expect(await getBalance(db, userId, bank)).not.toBe(balanceBefore);

    expect(await undoImport(db, userId, importId)).toMatchObject({ status: "undone", accountId: bank, restoredCount: 2 });
    expect(await snapshot(db, userId)).toEqual(before);
    expect(await getBalance(db, userId, bank)).toBe(balanceBefore);
    expect(await db.select().from(imports).where(eq(imports.id, importId))).toEqual([]);
    expect(await db.select().from(importUndo)).toEqual([]);
  });

  it("되돌린 뒤 같은 업로드나 앞 업로드는 되돌릴 수 없고, 계정마다 가장 최근 업로드만 되돌릴 수 있다", async () => {
    const { db, userId, upload } = await setup();
    const first = await upload(file([tx("2026-10-02", 100)]));
    const second = await upload(file([tx("2026-10-02", 200)]));
    expect((await listRecentImports(db, userId)).map((r) => [r.id, r.undoable])).toEqual([
      [second, true],
      [first, false],
    ]);
    await expect(undoImport(db, userId, first)).rejects.toThrow(/되돌릴 수 없습니다/);
    await undoImport(db, userId, second);
    await expect(undoImport(db, userId, second)).rejects.toThrow(/찾을 수 없습니다/);
    // 앞 업로드는 되돌리기 자료가 없어 되돌릴 수 없다.
    expect((await listRecentImports(db, userId)).map((r) => [r.id, r.undoable])).toEqual([[first, false]]);
    await expect(undoImport(db, userId, first)).rejects.toThrow(/되돌릴 수 없습니다/);
  });

  it("업로드 뒤 그 계정에 수동 거래를 넣거나 거래를 고치면 확인을 묻고, 카테고리만 바꾼 것은 묻지 않는다", async () => {
    const { db, userId, bank, upload } = await setup();
    const importId = await upload(file([tx("2026-10-02", -100, null, "이마트")]));
    const [mart] = await db.select().from(transactions).where(eq(transactions.description, "이마트"));
    await setTransactionCategory(db, userId, mart.id, await categoryIdOf(db, userId, "장보기"));
    const manual = await createTransaction(db, userId, { accountId: bank, date: "2026-11-05", time: null, amount: -3_000, description: "현금", memo: null });
    await setTransactionDeleted(db, userId, mart.id, true);

    const asked = await undoImport(db, userId, importId);
    expect(asked.status).toBe("needs_confirm");
    if (asked.status === "needs_confirm") expect(asked.touched.map((t) => t.id)).toEqual([mart.id, manual]);
    // 확인 전에는 아무것도 바뀌지 않는다.
    expect(await db.select().from(imports)).toHaveLength(1);

    // 일부만 확인하면 다시 묻는다.
    expect((await undoImport(db, userId, importId, { confirmedIds: [manual] })).status).toBe("needs_confirm");
    expect(await undoImport(db, userId, importId, { confirmedIds: [mart.id, manual] })).toMatchObject({ status: "undone", removedCount: 1 });
    // 업로드 뒤 넣은 수동 거래는 남는다.
    expect((await snapshot(db, userId)).map((r) => r.id)).toEqual([manual]);
  });

  it("계정 만들고 올리기로 만든 계정은 되돌려도 남는다", async () => {
    const { db, userId } = await createTestContext();
    const result = await applyImport(db, userId, {
      fileName: "카드.xls",
      file: { institution: "hana_card", period: { start: "2026-10-01", end: "2026-10-31" }, transactions: [tx("2026-10-02", -100)] },
      confirmedIds: [],
      createAccount: { name: "하나카드", kind: "card", institution: "hana_card", accountKey: null, openingBalance: 0, openingDate: null },
    });
    if (result.status !== "applied") throw new Error("반영되지 않았습니다.");
    await undoImport(db, userId, result.importId);
    expect((await db.select().from(accounts)).map((a) => a.name)).toEqual(["하나카드"]);
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it("되돌리기 자료가 없는 업로드(이전한 기록)는 되돌릴 수 없다", async () => {
    const { db, userId, bank } = await setup();
    const [migrated] = await db
      .insert(imports)
      .values({ userId, accountId: bank, fileName: "옛 파일.xls", periodStart: "2026-01-01", periodEnd: "2026-01-31", insertedCount: 0, deletedCount: 0 })
      .returning();
    expect(await listRecentImports(db, userId)).toMatchObject([{ id: migrated.id, undoable: false }]);
    await expect(undoImport(db, userId, migrated.id)).rejects.toThrow(/되돌릴 수 없습니다/);
  });
});

async function categoryIdOf(db: Db, userId: number, name: string) {
  const [row] = await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.name, name)));
  return row.id;
}
