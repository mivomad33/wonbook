import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, imports, transactions } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import { createAccount, deleteAccount, findAccountByKey, listAccounts, moveAccount, updateAccount } from "@/lib/accounts";
import { toAccountKeyRef } from "@/lib/privacy/account-key";

const asset = (name: string, extra: Partial<AccountInput> = {}): AccountInput => ({
  name,
  kind: "asset",
  institution: null,
  accountKey: null,
  openingBalance: 0,
  openingDate: null,
  ...extra,
});

const hana = async (key: string) => ({ institution: "hana_bank" as const, accountKey: await toAccountKeyRef("hana_bank", key) });

async function addTx(db: Db, userId: number, accountId: number, extra: Partial<typeof transactions.$inferInsert> = {}) {
  const [row] = await db
    .insert(transactions)
    .values({ userId, accountId, kind: "normal", source: "manual", date: "2026-10-01", amount: 1_000, ...extra })
    .returning({ id: transactions.id });
  return row.id;
}

const addImport = (db: Db, userId: number, accountId: number) =>
  db
    .insert(imports)
    .values({ userId, accountId, fileName: "f.xlsx", periodStart: "2026-10-01", periodEnd: "2026-10-31", insertedCount: 1, deletedCount: 0 });

const names = async (db: Db, userId: number) => (await listAccounts(db, userId)).map((a) => a.name);

describe("계정 만들기·수정", () => {
  it("종류 묶음(자산 → 부채 → 카드) 순서로 보여주고, 새 계정은 묶음 맨 아래에 들어간다", async () => {
    const { db, userId } = await createTestContext();
    await createAccount(db, userId, { ...asset("카드"), kind: "card", institution: "kb_card" });
    await createAccount(db, userId, { ...asset("대출"), kind: "liability" });
    await createAccount(db, userId, asset("자산1"));
    await createAccount(db, userId, asset("자산2"));
    expect(await names(db, userId)).toEqual(["자산1", "자산2", "대출", "카드"]);
  });

  it("같은 금융사·같은 식별값 계정이 있으면 그 이름과 함께 막는다", async () => {
    const { db, userId } = await createTestContext();
    await createAccount(db, userId, asset("급여통장", await hana("111")));
    await expect(createAccount(db, userId, asset("또 급여", await hana("111")))).rejects.toThrow(/급여통장/);
    // 식별값이 다르거나 금융사가 다르면 된다.
    await createAccount(db, userId, asset("생활비", await hana("222")));
    await createAccount(db, userId, asset("국민", { institution: "kb_bank", accountKey: await toAccountKeyRef("kb_bank", "111") }));

    await createAccount(db, userId, { ...asset("하나카드"), kind: "card", institution: "hana_card" });
    await expect(createAccount(db, userId, { ...asset("하나카드 2"), kind: "card", institution: "hana_card" })).rejects.toThrow(/하나카드/);
  });

  it("자기 자신과는 중복으로 보지 않는다", async () => {
    const { db, userId } = await createTestContext();
    const id = await createAccount(db, userId, asset("급여통장", await hana("111")));
    await updateAccount(db, userId, id, asset("이름 바꿈", await hana("111")));
    expect(await names(db, userId)).toEqual(["이름 바꿈"]);
  });

  it("거래가 있으면(삭제 표시 포함) 종류를 바꿀 수 없고, 없으면 바꾼 묶음의 맨 아래로 간다", async () => {
    const { db, userId } = await createTestContext();
    const a = await createAccount(db, userId, asset("a"));
    const b = await createAccount(db, userId, asset("b"));
    await createAccount(db, userId, { ...asset("빚1"), kind: "liability" });
    await addTx(db, userId, a, { deletedAt: "2026-10-19T00:00:00.000Z" });

    await expect(updateAccount(db, userId, a, { ...asset("a"), kind: "liability" })).rejects.toThrow(/종류를 바꿀 수 없습니다/);
    await updateAccount(db, userId, b, { ...asset("b"), kind: "liability" });
    expect(await names(db, userId)).toEqual(["a", "빚1", "b"]);
  });
});

describe("계좌 식별값 저장(4.7-1)", () => {
  it("계좌번호 대신 서버 키 해시와 끝 4자리만 저장하고, 같은 번호(하이픈 차이)로 계정을 찾는다", async () => {
    const { db, userId } = await createTestContext();
    const id = await createAccount(db, userId, asset("급여", await hana("111-222222-33333")));
    const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
    expect(row.externalKeyLast4).toBe("3333");
    expect(row.externalKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("11122222233333");
    const digest = (await toAccountKeyRef("hana_bank", "11122222233333"))!.digest;
    expect((await findAccountByKey(db, userId, "hana_bank", digest))?.id).toBe(id);
    // 목록에는 해시를 넣지 않는다(브라우저로 가는 값).
    const [listed] = await listAccounts(db, userId);
    expect(listed).toMatchObject({ externalKeyLast4: "3333" });
    expect(listed).not.toHaveProperty("externalKeyHash");
  });

  it("수정 때 식별값을 주지 않으면 그대로 두고, null이면 지우며, 금융사가 바뀌면 지운다", async () => {
    const { db, userId } = await createTestContext();
    const id = await createAccount(db, userId, asset("급여", await hana("111-222222-33333")));
    const keyOf = async () => (await db.select().from(accounts).where(eq(accounts.id, id)))[0];
    const before = await keyOf();
    await updateAccount(db, userId, id, { ...asset("이름만"), institution: "hana_bank", accountKey: undefined });
    expect(await keyOf()).toMatchObject({ name: "이름만", externalKeyHash: before.externalKeyHash, externalKeyLast4: "3333" });
    await updateAccount(db, userId, id, { ...asset("국민으로"), institution: "kb_bank", accountKey: undefined });
    expect(await keyOf()).toMatchObject({ externalKeyHash: null, externalKeyLast4: null });
    await updateAccount(db, userId, id, asset("다시", await hana("999-1")));
    await updateAccount(db, userId, id, { ...asset("지움"), institution: "hana_bank", accountKey: null });
    expect(await keyOf()).toMatchObject({ externalKeyHash: null, externalKeyLast4: null });
  });
});

describe("계정 목록 값", () => {
  it("거래 수는 삭제 표시를 빼고, 삭제 포함 수와 업로드 기록 수, 잔액(카드 제외)을 함께 준다", async () => {
    const { db, userId } = await createTestContext();
    const a = await createAccount(db, userId, asset("a", { openingBalance: 10_000 }));
    const card = await createAccount(db, userId, { ...asset("카드"), kind: "card", institution: "kb_card" });
    await addTx(db, userId, a);
    await addTx(db, userId, a, { deletedAt: "2026-10-19T00:00:00.000Z" });
    await addImport(db, userId, a);

    const [row, cardRow] = await listAccounts(db, userId);
    expect(row).toMatchObject({ id: a, transactionCount: 1, allTransactionCount: 2, importCount: 1, balance: 11_000 });
    expect(cardRow).toMatchObject({ id: card, balance: null });
  });
});

describe("계정 삭제", () => {
  it("거래와 업로드 기록이 함께 지워지고, 이체 반대쪽은 남아 transfer_peer_id가 null이 된다", async () => {
    const { db, userId } = await createTestContext();
    const a = await createAccount(db, userId, asset("a"));
    const b = await createAccount(db, userId, asset("b"));
    await addTx(db, userId, a);
    await addTx(db, userId, a, { deletedAt: "2026-10-19T00:00:00.000Z" });
    await addImport(db, userId, a);
    // 이체: a에서 b로 보냄
    const out = await addTx(db, userId, a, { kind: "transfer", amount: -5_000 });
    const inn = await addTx(db, userId, b, { kind: "transfer", amount: 5_000, transferPeerId: out });
    await db.update(transactions).set({ transferPeerId: inn }).where(eq(transactions.id, out));

    await deleteAccount(db, userId, a);

    expect((await db.select().from(accounts)).map((r) => r.id)).toEqual([b]);
    expect(await db.select().from(imports)).toEqual([]);
    const left = await db.select().from(transactions);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: inn, accountId: b, transferPeerId: null });
  });
});

describe("순서 바꾸기", () => {
  it("같은 묶음 안에서 바로 위·아래와 바꾸고, 끝에서는 그대로 둔다", async () => {
    const { db, userId } = await createTestContext();
    const a = await createAccount(db, userId, asset("a"));
    await createAccount(db, userId, asset("b"));
    const c = await createAccount(db, userId, asset("c"));
    const loan = await createAccount(db, userId, { ...asset("빚"), kind: "liability" });

    await moveAccount(db, userId, c, "up");
    expect(await names(db, userId)).toEqual(["a", "c", "b", "빚"]);
    await moveAccount(db, userId, a, "up"); // 맨 위
    await moveAccount(db, userId, loan, "up"); // 다른 묶음을 넘지 않는다
    expect(await names(db, userId)).toEqual(["a", "c", "b", "빚"]);
    await moveAccount(db, userId, a, "down");
    expect(await names(db, userId)).toEqual(["c", "a", "b", "빚"]);
  });

  it("sort_order가 겹쳐 있어도 한 칸씩 움직인다", async () => {
    const { db, userId } = await createTestContext();
    await db.insert(accounts).values([
      { userId, name: "a", kind: "asset", sortOrder: 0 },
      { userId, name: "b", kind: "asset", sortOrder: 0 },
      { userId, name: "c", kind: "asset", sortOrder: 0 },
    ]);
    const c = (await listAccounts(db, userId))[2].id;
    await moveAccount(db, userId, c, "up");
    expect(await names(db, userId)).toEqual(["a", "c", "b"]);
  });
});
