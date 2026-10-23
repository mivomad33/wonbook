import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, imports, transactions } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  moveAccount,
  updateAccount,
} from "@/lib/accounts";

type Db = ReturnType<typeof createTestDb>;

const asset = (name: string, extra: Partial<AccountInput> = {}): AccountInput => ({
  name,
  kind: "asset",
  institution: null,
  externalKey: null,
  openingBalance: 0,
  openingDate: null,
  ...extra,
});

function addTx(db: Db, accountId: number, extra: Partial<typeof transactions.$inferInsert> = {}) {
  return db
    .insert(transactions)
    .values({ accountId, kind: "normal", source: "manual", date: "2026-10-01", amount: 1_000, ...extra })
    .returning({ id: transactions.id })
    .get().id;
}

const names = (db: Db) => listAccounts(db).map((a) => a.name);

describe("계정 만들기·수정", () => {
  it("종류 묶음(자산 → 부채 → 카드) 순서로 보여주고, 새 계정은 묶음 맨 아래에 들어간다", () => {
    const db = createTestDb();
    createAccount(db, { ...asset("카드"), kind: "card", institution: "kb_card" });
    createAccount(db, { ...asset("대출"), kind: "liability" });
    createAccount(db, asset("자산1"));
    createAccount(db, asset("자산2"));
    expect(names(db)).toEqual(["자산1", "자산2", "대출", "카드"]);
  });

  it("같은 금융사·같은 식별값 계정이 있으면 그 이름과 함께 막는다", () => {
    const db = createTestDb();
    createAccount(db, asset("급여통장", { institution: "hana_bank", externalKey: "111" }));
    expect(() => createAccount(db, asset("또 급여", { institution: "hana_bank", externalKey: "111" }))).toThrow(/급여통장/);
    // 식별값이 다르거나 금융사가 다르면 된다.
    createAccount(db, asset("생활비", { institution: "hana_bank", externalKey: "222" }));
    createAccount(db, asset("국민", { institution: "kb_bank", externalKey: "111" }));

    createAccount(db, { ...asset("하나카드"), kind: "card", institution: "hana_card" });
    expect(() => createAccount(db, { ...asset("하나카드 2"), kind: "card", institution: "hana_card" })).toThrow(/하나카드/);
  });

  it("자기 자신과는 중복으로 보지 않는다", () => {
    const db = createTestDb();
    const id = createAccount(db, asset("급여통장", { institution: "hana_bank", externalKey: "111" }));
    updateAccount(db, id, asset("이름 바꿈", { institution: "hana_bank", externalKey: "111" }));
    expect(names(db)).toEqual(["이름 바꿈"]);
  });

  it("거래가 있으면(삭제 표시 포함) 종류를 바꿀 수 없고, 없으면 바꾼 묶음의 맨 아래로 간다", () => {
    const db = createTestDb();
    const a = createAccount(db, asset("a"));
    const b = createAccount(db, asset("b"));
    createAccount(db, { ...asset("빚1"), kind: "liability" });
    addTx(db, a, { deletedAt: "2026-10-19T00:00:00.000Z" });

    expect(() => updateAccount(db, a, { ...asset("a"), kind: "liability" })).toThrow(/종류를 바꿀 수 없습니다/);
    updateAccount(db, b, { ...asset("b"), kind: "liability" });
    expect(names(db)).toEqual(["a", "빚1", "b"]);
  });
});

describe("계정 목록 값", () => {
  it("거래 수는 삭제 표시를 빼고, 삭제 포함 수와 업로드 기록 수, 잔액(카드 제외)을 함께 준다", () => {
    const db = createTestDb();
    const a = createAccount(db, asset("a", { openingBalance: 10_000 }));
    const card = createAccount(db, { ...asset("카드"), kind: "card", institution: "kb_card" });
    addTx(db, a);
    addTx(db, a, { deletedAt: "2026-10-19T00:00:00.000Z" });
    db.insert(imports)
      .values({ accountId: a, fileName: "f.xlsx", periodStart: "2026-10-01", periodEnd: "2026-10-31", insertedCount: 1, deletedCount: 0 })
      .run();

    const [row, cardRow] = listAccounts(db);
    expect(row).toMatchObject({ id: a, transactionCount: 1, allTransactionCount: 2, importCount: 1, balance: 11_000 });
    expect(cardRow).toMatchObject({ id: card, balance: null });
  });
});

describe("계정 삭제", () => {
  it("거래와 업로드 기록이 함께 지워지고, 이체 반대쪽은 남아 transfer_peer_id가 null이 된다", () => {
    const db = createTestDb();
    const a = createAccount(db, asset("a"));
    const b = createAccount(db, asset("b"));
    addTx(db, a);
    addTx(db, a, { deletedAt: "2026-10-19T00:00:00.000Z" });
    db.insert(imports)
      .values({ accountId: a, fileName: "f.xlsx", periodStart: "2026-10-01", periodEnd: "2026-10-31", insertedCount: 1, deletedCount: 0 })
      .run();
    // 이체: a에서 b로 보냄
    const out = addTx(db, a, { kind: "transfer", amount: -5_000 });
    const inn = addTx(db, b, { kind: "transfer", amount: 5_000, transferPeerId: out });
    db.update(transactions).set({ transferPeerId: inn }).where(eq(transactions.id, out)).run();

    deleteAccount(db, a);

    expect(db.select().from(accounts).all().map((r) => r.id)).toEqual([b]);
    expect(db.select().from(imports).all()).toEqual([]);
    const left = db.select().from(transactions).all();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: inn, accountId: b, transferPeerId: null });
  });
});

describe("순서 바꾸기", () => {
  it("같은 묶음 안에서 바로 위·아래와 바꾸고, 끝에서는 그대로 둔다", () => {
    const db = createTestDb();
    const a = createAccount(db, asset("a"));
    createAccount(db, asset("b"));
    const c = createAccount(db, asset("c"));
    const loan = createAccount(db, { ...asset("빚"), kind: "liability" });

    moveAccount(db, c, "up");
    expect(names(db)).toEqual(["a", "c", "b", "빚"]);
    moveAccount(db, a, "up"); // 맨 위
    moveAccount(db, loan, "up"); // 다른 묶음을 넘지 않는다
    expect(names(db)).toEqual(["a", "c", "b", "빚"]);
    moveAccount(db, a, "down");
    expect(names(db)).toEqual(["c", "a", "b", "빚"]);
  });

  it("sort_order가 겹쳐 있어도 한 칸씩 움직인다", () => {
    const db = createTestDb();
    db.insert(accounts)
      .values([
        { name: "a", kind: "asset", sortOrder: 0 },
        { name: "b", kind: "asset", sortOrder: 0 },
        { name: "c", kind: "asset", sortOrder: 0 },
      ])
      .run();
    const c = listAccounts(db)[2].id;
    moveAccount(db, c, "up");
    expect(names(db)).toEqual(["a", "c", "b"]);
  });
});
