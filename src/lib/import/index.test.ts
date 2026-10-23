import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, imports, transactions } from "@/db/schema";
import { getBalance } from "@/lib/balance";
import { findAccountByKey } from "@/lib/accounts";
import { applyImport, normalizeAccountKey, openingFromFile, planImport } from "@/lib/import";
import type { ParsedFile, ParsedTransaction } from "@/lib/parsers";
import { createTransaction, createTransfer, setTransactionDeleted, updateTransaction } from "@/lib/transactions";

type Db = ReturnType<typeof createTestDb>;

const tx = (date: string, amount: number, extra: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  date,
  time: null,
  amount,
  description: "파일 거래",
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
  raw: {},
  ...extra,
});

const file = (transactionsInFile: ParsedTransaction[], period = { start: "2026-10-01", end: "2026-10-31" }): ParsedFile => ({
  institution: "hana_bank",
  accountKey: "111-222222-33333",
  period,
  transactions: transactionsInFile,
});

function setup() {
  const db = createTestDb();
  const add = (values: typeof accounts.$inferInsert) => db.insert(accounts).values(values).returning().get().id;
  const bank = add({ name: "하나", kind: "asset", institution: "hana_bank", externalKey: "11122222233333" });
  const other = add({ name: "수동 계좌", kind: "asset" });
  return { db, bank, other };
}

function addUpload(db: Db, accountId: number, date: string, amount = -1_000) {
  return db
    .insert(transactions)
    .values({ accountId, kind: "normal", source: "upload", date, amount })
    .returning({ id: transactions.id })
    .get().id;
}

const rowsOf = (db: Db, accountId: number) =>
  db.select().from(transactions).where(eq(transactions.accountId, accountId)).orderBy(transactions.id).all();

const apply = (db: Db, accountId: number, parsed: ParsedFile, confirmedIds: number[] = []) =>
  applyImport(db, { accountId, fileName: "하나.xls", parsed, confirmedIds, backupPath: null });

describe("계정 찾기", () => {
  it("숫자만 남기고, 카카오뱅크는 끝 4자리, 카드사는 쓰지 않는다", () => {
    expect(normalizeAccountKey("hana_bank", " 111-222222-33333 ")).toBe("11122222233333");
    expect(normalizeAccountKey("kis", "12345678-01")).toBe("1234567801");
    expect(normalizeAccountKey("kakao_bank", "****-**-***1234")).toBe("1234");
    expect(normalizeAccountKey("kakao_bank", "3333-01-2341234")).toBe("1234");
    expect(normalizeAccountKey("hana_card", "1234")).toBeNull();
    expect(normalizeAccountKey("kb_bank", "--")).toBeNull();
  });

  it("금융사와 정규화한 값이 같은 계정을 찾고, 정규화 전에 저장한 값도 찾는다", () => {
    const { db, bank } = setup();
    const old = db
      .insert(accounts)
      .values({ name: "국민", kind: "asset", institution: "kb_bank", externalKey: "123456-01-234567" })
      .returning()
      .get().id;
    const card = db.insert(accounts).values({ name: "하나카드", kind: "card", institution: "hana_card" }).returning().get().id;
    expect(findAccountByKey(db, "hana_bank", "111-222222-33333")?.id).toBe(bank);
    expect(findAccountByKey(db, "kb_bank", "123456-01-234567")?.id).toBe(old);
    expect(findAccountByKey(db, "hana_card", null)?.id).toBe(card);
    expect(findAccountByKey(db, "hana_bank", "999")).toBeUndefined();
    expect(findAccountByKey(db, "kb_card", null)).toBeUndefined();
  });
});

describe("새 계정의 기초 잔액", () => {
  it("가장 오래된 거래 직전 잔액과 조회기간 시작 전날", () => {
    const parsed = file([tx("2026-10-03", -3_000, { balanceAfter: 7_000 }), tx("2026-10-05", 500, { balanceAfter: 7_500 })]);
    expect(openingFromFile(parsed)).toEqual({ openingBalance: 10_000, openingDate: "2026-09-30" });
    expect(openingFromFile(file([], { start: "2026-03-01", end: "2026-03-31" }))).toEqual({ openingBalance: 0, openingDate: null });
  });

  it("거래가 없는 파일과 카드(거래 후 잔액 없음)는 0, 기준일 없음", () => {
    expect(openingFromFile(file([]))).toEqual({ openingBalance: 0, openingDate: null });
    const card = { ...file([tx("2026-10-03", -3_000)]), institution: "hana_card" as const, accountKey: null };
    expect(openingFromFile(card)).toEqual({ openingBalance: 0, openingDate: null });
  });

  it("조회기간 시작이 1월 1일이면 기준일은 앞 해 12월 31일", () => {
    const parsed = file([tx("2026-01-01", 100, { balanceAfter: 100 })], { start: "2026-01-01", end: "2026-01-31" });
    expect(openingFromFile(parsed).openingDate).toBe("2025-12-31");
  });
});

describe("기간 덮어쓰기", () => {
  it("기간 안 거래는 업로드·수동·삭제 표시를 가리지 않고 지우고, 기간 밖과 다른 계정은 그대로 둔다", () => {
    const { db, bank, other } = setup();
    const before = addUpload(db, bank, "2026-09-30");
    const after = addUpload(db, bank, "2026-11-01");
    addUpload(db, bank, "2026-10-01");
    addUpload(db, bank, "2026-10-31");
    const manual = createTransaction(db, { accountId: bank, date: "2026-10-15", time: null, amount: -500, description: "현금", memo: null });
    const deleted = addUpload(db, bank, "2026-10-20");
    setTransactionDeleted(db, deleted, true);
    const otherTx = addUpload(db, other, "2026-10-10");

    // 기간 앞 거래(−1,000)에 이어지는 잔액이라 보정이 생기지 않는다.
    const parsed = file([tx("2026-10-02", -2_000, { time: "09:00:00", balanceAfter: -3_000 }), tx("2026-10-02", 300, { memo: "메모" })]);
    const result = apply(db, bank, parsed, [manual, deleted]);
    expect(result).toMatchObject({ status: "applied", insertedCount: 2, deletedCount: 4 });

    const rows = rowsOf(db, bank);
    expect(rows.filter((r) => r.date < "2026-10-01" || r.date > "2026-10-31").map((r) => r.id)).toEqual([before, after]);
    const inserted = rows.filter((r) => r.date >= "2026-10-01" && r.date <= "2026-10-31");
    expect(inserted).toHaveLength(2);
    expect(inserted.map((r) => r.seq)).toEqual([1, 2]);
    expect(inserted[0]).toMatchObject({
      kind: "normal",
      source: "upload",
      time: "09:00:00",
      amount: -2_000,
      balanceAfter: -3_000,
      raw: {},
      categoryId: null,
      importId: result.status === "applied" ? result.importId : -1,
    });
    expect(inserted[1].memo).toBe("메모");
    expect(rowsOf(db, other).map((r) => r.id)).toEqual([otherTx]);

    const record = db.select().from(imports).get();
    expect(record).toMatchObject({
      accountId: bank,
      fileName: "하나.xls",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      insertedCount: 2,
      deletedCount: 4,
      backupPath: null,
    });
  });

  it("같은 파일을 두 번 올려도 거래 수가 같다", () => {
    const { db, bank } = setup();
    const parsed = file([tx("2026-10-02", -2_000), tx("2026-10-03", 5_000), tx("2026-10-03", 5_000)]);
    apply(db, bank, parsed);
    const second = apply(db, bank, parsed);
    expect(second).toMatchObject({ status: "applied", insertedCount: 3, deletedCount: 3 });
    expect(rowsOf(db, bank)).toHaveLength(3);
    expect(db.select().from(imports).all()).toHaveLength(2);
  });

  it("거래가 없는 파일도 기간 안 거래를 지우고 기록을 남긴다", () => {
    const { db, bank } = setup();
    addUpload(db, bank, "2026-10-10");
    expect(apply(db, bank, file([]))).toMatchObject({ status: "applied", insertedCount: 0, deletedCount: 1 });
    expect(rowsOf(db, bank)).toHaveLength(0);
  });

  it("이체 한쪽이 지워지면 반대쪽은 남고 transfer_peer_id가 null이 된다", () => {
    const { db, bank, other } = setup();
    const [out, inn] = createTransfer(db, {
      fromAccountId: bank,
      toAccountId: other,
      date: "2026-10-05",
      time: null,
      amount: 10_000,
      description: "옮김",
      memo: null,
    });
    expect(planImport(db, bank, file([])).touched.map((t) => t.id)).toEqual([out]);
    apply(db, bank, file([tx("2026-10-05", -10_000)]), [out]);
    const peer = rowsOf(db, other);
    expect(peer.map((r) => r.id)).toEqual([inn]);
    expect(peer[0]).toMatchObject({ kind: "transfer", amount: 10_000, transferPeerId: null });
  });

  it("계정 금융사와 파일 금융사가 다르거나 기간 밖 거래가 있으면 막는다", () => {
    const { db, bank, other } = setup();
    expect(() => apply(db, other, file([]))).toThrow(/금융사/);
    expect(() => apply(db, bank, file([tx("2026-11-01", 100)]))).toThrow(/기간/);
    expect(db.select().from(imports).all()).toHaveLength(0);
  });

  it("계정 만들고 올리기는 계정과 거래를 함께 넣고, 반영하다 실패하면 계정도 만들지 않는다", () => {
    const db = createTestDb();
    const parsed = { ...file([tx("2026-10-05", -1_000)]), institution: "kakao_bank" as const, accountKey: "3333-01-2341234" };
    const createAccount = { name: "카카오뱅크 1234", kind: "asset" as const, institution: "kakao_bank" as const, externalKey: "1234", openingBalance: 0, openingDate: null };
    const base = { fileName: "카카오.xlsx", confirmedIds: [], backupPath: null };

    expect(() => applyImport(db, { ...base, createAccount, parsed: { ...parsed, transactions: [tx("2026-11-01", 100)] } })).toThrow(/기간/);
    expect(db.select().from(accounts).all()).toHaveLength(0);

    const result = applyImport(db, { ...base, createAccount, parsed });
    expect(result).toMatchObject({ status: "applied", insertedCount: 1 });
    const account = db.select().from(accounts).get()!;
    expect(account).toMatchObject({ name: "카카오뱅크 1234", institution: "kakao_bank" });
    expect(result.accountId).toBe(account.id);
    expect(rowsOf(db, account.id)).toHaveLength(1);
  });
});

describe("손댄 거래 확인", () => {
  function touchedSetup() {
    const s = setup();
    const { db, bank } = s;
    const plain = addUpload(db, bank, "2026-10-01");
    const edited = addUpload(db, bank, "2026-10-02");
    updateTransaction(db, edited, { accountId: bank, date: "2026-10-02", time: null, amount: -1_000, description: "고침", memo: null });
    const deleted = addUpload(db, bank, "2026-10-03");
    setTransactionDeleted(db, deleted, true);
    const manual = createTransaction(db, { accountId: bank, date: "2026-10-04", time: null, amount: -500, description: "현금", memo: null });
    const outside = createTransaction(db, { accountId: bank, date: "2026-11-04", time: null, amount: -500, description: "현금", memo: null });
    return { ...s, plain, edited, deleted, manual, outside };
  }

  it("기간 안의 수동·수정함·삭제 표시 거래가 미리 계산 결과에 나오고, 미리 계산은 DB를 바꾸지 않는다", () => {
    const { db, bank, edited, deleted, manual } = touchedSetup();
    const before = rowsOf(db, bank);
    const plan = planImport(db, bank, file([tx("2026-10-05", 100)]));
    expect(plan.deleteCount).toBe(4);
    expect(plan.insertCount).toBe(1);
    expect(plan.touched.map((t) => t.id)).toEqual([edited, deleted, manual]);
    expect(plan.touched[0]).toMatchObject({ source: "upload", description: "고침" });
    expect(rowsOf(db, bank)).toEqual(before);
  });

  it("확인받지 않은 손댄 거래가 있으면 반영하지 않고 DB를 그대로 둔다(취소)", () => {
    const { db, bank, edited, deleted } = touchedSetup();
    const before = rowsOf(db, bank);
    const result = apply(db, bank, file([tx("2026-10-05", 100)]), [edited, deleted]);
    expect(result.status).toBe("needs_confirm");
    expect(rowsOf(db, bank)).toEqual(before);
    expect(db.select().from(imports).all()).toHaveLength(0);
  });

  it("미리 계산한 뒤 손댄 거래가 늘었으면 반영하지 않고 새 목록으로 다시 묻는다", () => {
    const { db, bank, edited, deleted, manual } = touchedSetup();
    const parsed = file([tx("2026-10-05", 100)]);
    const confirmed = planImport(db, bank, parsed).touched.map((t) => t.id);
    const added = createTransaction(db, { accountId: bank, date: "2026-10-09", time: null, amount: -700, description: "새로", memo: null });

    const result = apply(db, bank, parsed, confirmed);
    expect(result.status).toBe("needs_confirm");
    if (result.status === "needs_confirm") expect(result.plan.touched.map((t) => t.id)).toEqual([edited, deleted, manual, added]);
    expect(db.$client.prepare("select count(*) as n from transactions").get()).toEqual({ n: 6 });
  });

  it("확인받은 거래가 그 사이 줄었으면 그대로 반영한다", () => {
    const { db, bank, manual, outside } = touchedSetup();
    const parsed = file([tx("2026-10-05", 100)]);
    const confirmed = planImport(db, bank, parsed).touched.map((t) => t.id);
    db.delete(transactions).where(eq(transactions.id, manual)).run();
    expect(apply(db, bank, parsed, confirmed)).toMatchObject({ status: "applied", deletedCount: 3 });
    expect(rowsOf(db, bank).map((r) => r.id)).toContain(outside);
  });
});

describe("보정 거래(4단계 파일 3·4·6.1장)", () => {
  const adjustmentsOf = (db: Db, accountId: number) => rowsOf(db, accountId).filter((r) => r.kind === "adjustment");
  const ordered = (db: Db, accountId: number) =>
    rowsOf(db, accountId).toSorted((a, b) => a.date.localeCompare(b.date) || (a.seq ?? 0) - (b.seq ?? 0));

  it("계산 잔액과 그날 마지막 거래 후 잔액이 다른 날마다 그날 거래 바로 뒤에 보정 거래를 넣는다", () => {
    const { db, bank } = setup();
    db.update(accounts).set({ openingBalance: 10_000 }).where(eq(accounts.id, bank)).run();
    const parsed = file([
      tx("2026-10-02", -1_000, { time: "09:00:00", balanceAfter: 9_000 }), // 맞음
      tx("2026-10-03", 2_000, { time: "10:00:00", balanceAfter: 11_000 }),
      tx("2026-10-03", -500, { time: "11:00:00", balanceAfter: 10_700 }), // 계산 10,500 → +200
      tx("2026-10-04", -700, { time: "08:00:00", balanceAfter: 10_000 }), // 맞음
    ]);
    const result = apply(db, bank, parsed);
    expect(result).toMatchObject({ status: "applied", insertedCount: 4, newAdjustments: { count: 1, total: 200 } });

    const rows = ordered(db, bank);
    expect(rows.map((r) => [r.date, r.seq, r.kind])).toEqual([
      ["2026-10-02", 1, "normal"],
      ["2026-10-03", 2, "normal"],
      ["2026-10-03", 3, "normal"],
      ["2026-10-03", 4, "adjustment"],
      ["2026-10-04", 5, "normal"],
    ]);
    expect(rows[3]).toMatchObject({
      source: "system",
      time: "11:00:00",
      amount: 200,
      description: "잔액 보정",
      balanceAfter: 10_700,
      method: null,
      memo: null,
      raw: null,
      importId: result.status === "applied" ? result.importId : -1,
    });
    expect(getBalance(db, bank)).toBe(10_000);
  });

  it("잔액이 모두 맞으면 보정 거래가 없다", () => {
    const { db, bank } = setup();
    const result = apply(db, bank, file([tx("2026-10-02", 5_000, { balanceAfter: 5_000 })]));
    expect(result).toMatchObject({ newAdjustments: { count: 0, total: 0 } });
    expect(adjustmentsOf(db, bank)).toHaveLength(0);
  });

  it("같은 파일을 다시 올려도 쌓이지 않고, 같은 날짜·금액의 보정은 created_at을 이어받는다", () => {
    const { db, bank } = setup();
    const parsed = file([tx("2026-10-02", 1_000, { balanceAfter: 1_500 }), tx("2026-10-05", 1_000, { balanceAfter: 2_000 })]);
    apply(db, bank, parsed);
    const first = adjustmentsOf(db, bank);
    expect(first.map((r) => r.amount)).toEqual([500, -500]);
    db.update(transactions).set({ createdAt: "2026-10-01T00:00:00.000Z" }).where(eq(transactions.kind, "adjustment")).run();

    const second = apply(db, bank, parsed);
    expect(second).toMatchObject({ status: "applied", newAdjustments: { count: 0, total: 0 } });
    const again = adjustmentsOf(db, bank);
    expect(again).toHaveLength(2);
    expect(again.every((r) => r.createdAt === "2026-10-01T00:00:00.000Z")).toBe(true);

    // 금액이 달라진 보정은 새로 생긴 것으로 센다.
    const changed = file([tx("2026-10-02", 1_000, { balanceAfter: 1_800 }), tx("2026-10-05", 1_000, { balanceAfter: 2_000 })]);
    expect(apply(db, bank, changed)).toMatchObject({ newAdjustments: { count: 2, total: 800 + -800 } });
  });

  it("카드 계정, 거래 후 잔액이 없는 파일, 거래가 없는 파일에는 보정 거래가 생기지 않는다", () => {
    const { db, bank } = setup();
    const card = db.insert(accounts).values({ name: "하나카드", kind: "card", institution: "hana_card" }).returning().get().id;
    const cardFile: ParsedFile = { ...file([tx("2026-10-02", -1_000, { balanceAfter: 99 })]), institution: "hana_card", accountKey: null };
    apply(db, card, cardFile);
    expect(adjustmentsOf(db, card)).toHaveLength(0);

    apply(db, bank, file([tx("2026-10-02", -1_000), tx("2026-10-03", -2_000)]));
    expect(adjustmentsOf(db, bank)).toHaveLength(0);
    apply(db, bank, file([]));
    expect(adjustmentsOf(db, bank)).toHaveLength(0);
  });

  it("기초 잔액 기준일 당일과 이전 날은 비교하지 않고, 그 차이는 기준일 다음 첫 비교 날에 맞춘다", () => {
    const { db, bank } = setup();
    db.update(accounts).set({ openingBalance: 100_000, openingDate: "2026-10-10" }).where(eq(accounts.id, bank)).run();
    apply(
      db,
      bank,
      file([
        tx("2026-10-05", -1_000, { balanceAfter: 50 }),
        tx("2026-10-10", -1_000, { balanceAfter: 60 }),
        tx("2026-10-12", 5_000, { balanceAfter: 110_000 }), // 계산 105,000 → +5,000
      ]),
    );
    expect(adjustmentsOf(db, bank).map((r) => [r.date, r.amount])).toEqual([["2026-10-12", 5_000]]);
    expect(getBalance(db, bank)).toBe(110_000);
  });

  it("덮어쓸 기간 뒤에 거래가 있어도 기간 시작 직전 잔액은 그 거래를 빼고 계산한다", () => {
    const { db, bank } = setup();
    // 1~6월이 반영된 계정: 달마다 1,000씩 들어와 잔액이 1,000, 2,000, … 6,000
    const months = ["01", "02", "03", "04", "05", "06"];
    apply(
      db,
      bank,
      file(
        months.map((m, i) => tx(`2026-${m}-10`, 1_000, { balanceAfter: (i + 1) * 1_000 })),
        { start: "2026-01-01", end: "2026-06-30" },
      ),
    );
    expect(adjustmentsOf(db, bank)).toHaveLength(0);
    // 기간 끝 뒤의 수동 거래도 기간 시작 직전 잔액에 들어가지 않는다.
    createTransaction(db, { accountId: bank, date: "2026-07-01", time: null, amount: -300, description: "현금", memo: null });

    // 2~3월을 다시 올린다. 기간 시작 직전 잔액은 1월까지인 1,000이다.
    const result = apply(
      db,
      bank,
      file([tx("2026-02-10", 1_000, { balanceAfter: 2_000 }), tx("2026-03-10", 1_000, { balanceAfter: 3_000 })], {
        start: "2026-02-01",
        end: "2026-03-31",
      }),
    );
    expect(result).toMatchObject({ status: "applied", newAdjustments: { count: 0 } });
    expect(adjustmentsOf(db, bank)).toHaveLength(0);
    expect(getBalance(db, bank)).toBe(6_000 - 300);
  });
});
