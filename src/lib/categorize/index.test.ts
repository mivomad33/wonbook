import { describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, categories, categoryRules, transactions } from "@/db/schema";
import { applyImport } from "@/lib/import";
import type { ParsedTransaction } from "@/lib/parsers";
import { createTransaction, createTransfer, setTransactionDeleted } from "@/lib/transactions";
import type { Classifier, ClassifyItem } from "./claude";
import { createCategory } from "@/lib/categories";
import {
  CLASSIFY_BATCH,
  categoryCountsByImport,
  classifyPending,
  countOtherAiRules,
  countPending,
  listCategoryInfos,
  reclassifyOthers,
  setTransactionCategory,
} from "./index";

type Db = ReturnType<typeof createTestDb>;

const row = (description: string, amount = -1_000, extra: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  date: "2026-10-10",
  time: null,
  amount,
  description,
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
  raw: {},
  ...extra,
});

function setup() {
  const db = createTestDb();
  const add = (values: typeof accounts.$inferInsert) => db.insert(accounts).values(values).returning().get().id;
  const card = add({ name: "하나카드", kind: "card", institution: "hana_card" });
  const bank = add({ name: "하나", kind: "asset", institution: "hana_bank", externalKey: "1", openingBalance: 0 });
  const categoryId = (name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!.id;
  const upload = (accountId: number, rows: ParsedTransaction[]) => {
    const result = applyImport(db, {
      accountId,
      fileName: "파일",
      parsed: {
        institution: accountId === card ? "hana_card" : "hana_bank",
        accountKey: null,
        period: { start: "2026-10-01", end: "2026-10-31" },
        transactions: rows,
      },
      confirmedIds: [],
      backupPath: null,
    });
    if (result.status !== "applied") throw new Error("반영되지 않았습니다.");
    return result.importId;
  };
  return { db, card, bank, categoryId, upload };
}

// 문구에 따라 답하는 가짜 Claude API. 답을 정하지 않은 문구는 "기타 지출"이다.
function fakeClassifier(answers: Record<string, string> = {}) {
  return vi.fn<Classifier>(async (items) => new Map(items.map((it) => [it.id, answers[it.description ?? it.method ?? ""] ?? "기타 지출"])));
}

const listRows = (db: Db) =>
  db
    .select({
      description: transactions.description,
      kind: transactions.kind,
      category: categories.name,
      source: transactions.categorySource,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .orderBy(asc(transactions.id))
    .all();

const sentItems = (classify: ReturnType<typeof fakeClassifier>): ClassifyItem[] => classify.mock.calls.flatMap((c) => c[0]);

describe("처음 카테고리", () => {
  it("마이그레이션으로 버전 B 25개가 묶음 순서대로 들어 있다", () => {
    const { db } = setup();
    const infos = listCategoryInfos(db);
    expect(infos).toHaveLength(25);
    expect(infos.filter((c) => c.group === "expense")).toHaveLength(16);
    expect(infos.filter((c) => c.group === "income")).toHaveLength(6);
    expect(infos.filter((c) => c.group === "move").map((c) => c.name)).toEqual(["카드대금", "내 계좌·페이 이동", "개인 송금"]);
    expect(infos[0]).toEqual({ name: "장보기", group: "expense" });
  });
});

describe("classifyPending", () => {
  it("저장된 분류는 반영할 때 saved로, 나머지는 API 결과로 ai가 붙고 규칙으로 저장된다", async () => {
    const { db, card, categoryId, upload } = setup();
    db.insert(categoryRules).values({ matchKey: "스타벅스", categoryId: categoryId("카페·간식"), source: "ai", updatedAt: "2026-10-01" }).run();
    const importId = upload(card, [row("스타벅스"), row("이마트"), row("(주)이마트"), row("김밥천국")]);
    // 반영만 했을 때: 규칙이 있는 거래만 saved
    expect(listRows(db).map((r) => r.source)).toEqual(["saved", null, null, null]);

    const classify = fakeClassifier({ 이마트: "장보기", 김밥천국: "외식·배달" });
    const result = await classifyPending(db, { classify, importIds: [importId] });
    expect(result).toEqual({ saved: 0, ai: 3, pending: 0, error: null });
    expect(listRows(db).map((r) => [r.description, r.category, r.source])).toEqual([
      ["스타벅스", "카페·간식", "saved"],
      ["이마트", "장보기", "ai"],
      ["(주)이마트", "장보기", "ai"],
      ["김밥천국", "외식·배달", "ai"],
    ]);
    // 같은 키(이마트, (주)이마트)는 한 번만 묻는다.
    expect(classify).toHaveBeenCalledTimes(1);
    expect(sentItems(classify).map((it) => it.description)).toEqual(["이마트", "김밥천국"]);
    expect(db.select({ key: categoryRules.matchKey, source: categoryRules.source }).from(categoryRules).all()).toEqual([
      { key: "스타벅스", source: "ai" },
      { key: "이마트", source: "ai" },
      { key: "김밥천국", source: "ai" },
    ]);
    expect(categoryCountsByImport(db, [importId]).get(importId)).toEqual({ saved: 1, ai: 3, pending: 0 });

    // 다시 올리면 모두 저장된 분류로 붙고 API를 부르지 않는다.
    const again = upload(card, [row("스타벅스"), row("이마트"), row("(주)이마트"), row("김밥천국")]);
    const second = fakeClassifier();
    expect(await classifyPending(db, { classify: second, importIds: [again] })).toEqual({ saved: 0, ai: 0, pending: 0, error: null });
    expect(second).not.toHaveBeenCalled();
    expect(listRows(db).map((r) => r.source)).toEqual(["saved", "saved", "saved", "saved"]);
  });

  it("보낼 칸: 문구·방향·방식·계정 종류만 보내고, method로 만든 키는 문구 원문을 보내지 않는다", async () => {
    const { db, card, bank, upload } = setup();
    const ids = [
      upload(card, [row("쿠팡", 5_000, { method: "일시불", memo: "메모", cardLabel: "본인 1234" })]),
      upload(bank, [row("123-456789-01", -100_000, { method: "청약종합" })]),
    ];
    const classify = fakeClassifier();
    await classifyPending(db, { classify, importIds: ids });
    expect(sentItems(classify)).toEqual([
      { id: "1", description: "쿠팡", direction: "in", method: "일시불", account: "card" },
      { id: "2", description: null, direction: "out", method: "청약종합", account: "bank" },
    ]);
  });

  it("user 규칙은 반영 때 붙고, API를 기다리는 사이 생긴 규칙도 AI 결과가 덮어쓰지 않는다", async () => {
    const { db, card, categoryId, upload } = setup();
    db.insert(categoryRules).values({ matchKey: "다이소", categoryId: categoryId("생활용품"), source: "user", updatedAt: "2026-10-01" }).run();
    const importId = upload(card, [row("다이소"), row("올리브영")]);
    const classify = vi.fn<Classifier>(async (items) => {
      // 그사이 사용자가 올리브영을 고쳤다.
      db.insert(categoryRules).values({ matchKey: "올리브영", categoryId: categoryId("쇼핑·의류"), source: "user", updatedAt: "2026-10-02" }).run();
      return new Map(items.map((it) => [it.id, "기타 지출"]));
    });
    const result = await classifyPending(db, { classify, importIds: [importId] });
    expect(result).toEqual({ saved: 1, ai: 0, pending: 0, error: null });
    expect(listRows(db).map((r) => [r.category, r.source])).toEqual([
      ["생활용품", "saved"],
      ["쇼핑·의류", "saved"],
    ]);
    expect(db.select({ source: categoryRules.source }).from(categoryRules).where(eq(categoryRules.matchKey, "올리브영")).get()).toEqual({ source: "user" });
  });

  it("목록 밖의 답과 답이 없는 id는 미분류로 두고 규칙을 만들지 않는다", async () => {
    const { db, card, upload } = setup();
    const importId = upload(card, [row("가게하나"), row("가게둘"), row("가게셋")]);
    const classify = vi.fn<Classifier>(async () => new Map([["1", "없는 카테고리"], ["3", "장보기"]]));
    expect(await classifyPending(db, { classify, importIds: [importId] })).toEqual({ saved: 0, ai: 1, pending: 2, error: null });
    expect(listRows(db).map((r) => r.category)).toEqual([null, null, "장보기"]);
    expect(db.select().from(categoryRules).all()).toHaveLength(1);
  });

  it("API가 실패한 묶음은 미분류로 두고 이유를 돌려주며, 다른 묶음은 분류한다", async () => {
    const { db, card, upload } = setup();
    // 키가 묶음 크기보다 하나 많아 두 번 묻는다. 숫자는 키에서 지워지므로 영문으로 다르게 만든다.
    const names = Array.from({ length: CLASSIFY_BATCH + 1 }, (_, i) => `SHOP${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    const importId = upload(card, names.map((n) => row(n)));
    let call = 0;
    const classify = vi.fn<Classifier>(async (items) => {
      if (call++ === 0) throw new Error("overloaded");
      return new Map(items.map((it) => [it.id, "기타 지출"]));
    });
    const result = await classifyPending(db, { classify, importIds: [importId] });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ saved: 0, ai: 1, pending: CLASSIFY_BATCH, error: { kind: "failed", message: "overloaded" } });
  });

  it("API 키가 없으면 저장된 분류만 붙이고 이유를 돌려준다", async () => {
    const { db, card, upload } = setup();
    const importId = upload(card, [row("이마트")]);
    expect(await classifyPending(db, { classify: null, importIds: [importId] })).toEqual({ saved: 0, ai: 0, pending: 1, error: { kind: "no_key" } });
  });

  it("이체·보정·수동 거래와 삭제 표시한 거래에는 붙이지 않는다", async () => {
    const { db, bank, card, upload } = setup();
    const cash = db.insert(accounts).values({ name: "지갑", kind: "asset" }).returning().get().id;
    createTransaction(db, { accountId: cash, date: "2026-11-01", time: null, amount: -1_000, description: "현금", memo: null });
    createTransfer(db, { fromAccountId: bank, toAccountId: cash, date: "2026-11-01", time: null, amount: 1_000, description: "이체", memo: null });
    // 기초 잔액 0인데 실제 잔액이 1만 원이라 보정 거래가 생긴다.
    upload(bank, [row("이자", 100, { balanceAfter: 10_100 })]);
    upload(card, [row("이마트"), row("지운 가게")]);
    setTransactionDeleted(db, db.select().from(transactions).where(eq(transactions.description, "지운 가게")).get()!.id, true);
    const classify = fakeClassifier({ 이자: "이자·배당", 이마트: "장보기" });
    await classifyPending(db, { classify });
    expect(listRows(db).map((r) => [r.kind, r.description, r.category])).toEqual([
      ["normal", "현금", null],
      ["transfer", "이체", null],
      ["transfer", "이체", null],
      ["normal", "이자", "이자·배당"],
      ["adjustment", "잔액 보정", null],
      ["normal", "이마트", "장보기"],
      ["normal", "지운 가게", null],
    ]);
    expect(sentItems(classify).map((it) => it.description)).toEqual(["이자", "이마트"]);
  });

  it("범위 없이 부르면(다시 분류) 미분류 업로드 거래 전체를 분류하고, 이미 붙은 카테고리는 바꾸지 않는다", async () => {
    const { db, bank, card, categoryId, upload } = setup();
    // 처음에는 API 키가 없어 두 업로드 모두 미분류로 남았다.
    const ids = [upload(card, [row("이마트"), row("김밥천국")]), upload(bank, [row("홍길동", 50_000)])];
    await classifyPending(db, { classify: null, importIds: ids });
    expect(countPending(db)).toBe(3);
    // 그중 하나는 사용자가 골랐다.
    db.update(transactions)
      .set({ categoryId: categoryId("외식·배달"), categorySource: "user" })
      .where(eq(transactions.description, "김밥천국"))
      .run();

    const classify = fakeClassifier({ 이마트: "장보기", 홍길동: "개인 송금", 김밥천국: "기타 지출" });
    expect(await classifyPending(db, { classify })).toEqual({ saved: 0, ai: 2, pending: 0, error: null });
    expect(sentItems(classify).map((it) => it.description)).toEqual(["이마트", "홍길동"]);
    expect(listRows(db).map((r) => [r.description, r.category, r.source])).toEqual([
      ["이마트", "장보기", "ai"],
      ["김밥천국", "외식·배달", "user"],
      ["홍길동", "개인 송금", "ai"],
    ]);
    expect(countPending(db)).toBe(0);
  });
});

const idOf = (db: Db, description: string) => db.select().from(transactions).where(eq(transactions.description, description)).get()!.id;
const rulesOf = (db: Db) =>
  db
    .select({ key: categoryRules.matchKey, category: categories.name, source: categoryRules.source })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .orderBy(asc(categoryRules.id))
    .all();

describe("setTransactionCategory", () => {
  it("업로드 거래를 바꾸면 거래와 규칙이 user가 되고 edited_at은 그대로다. 다시 올린 거래에도 바꾼 카테고리가 붙는다", async () => {
    const { db, card, categoryId, upload } = setup();
    upload(card, [row("다이소"), row("올리브영")]);
    await classifyPending(db, { classify: fakeClassifier({ 다이소: "장보기", 올리브영: "생활용품" }) });

    expect(setTransactionCategory(db, idOf(db, "다이소"), categoryId("생활용품"))).toEqual({ sameKeyCount: 0 });
    const changed = db.select().from(transactions).where(eq(transactions.description, "다이소")).get()!;
    expect([changed.categorySource, changed.editedAt]).toEqual(["user", null]);
    expect(rulesOf(db)).toEqual([
      { key: "다이소", category: "생활용품", source: "user" },
      { key: "올리브영", category: "생활용품", source: "ai" },
    ]);

    // 같은 기간을 다시 올려도(손댄 거래가 아니라 확인 없이 덮어쓴다) 바꾼 카테고리가 붙는다.
    upload(card, [row("다이소"), row("올리브영")]);
    expect(listRows(db).map((r) => [r.description, r.category, r.source])).toEqual([
      ["다이소", "생활용품", "saved"],
      ["올리브영", "생활용품", "saved"],
    ]);
  });

  it("같은 키의 saved·ai·미분류 거래도 함께 바꾸고, user 거래와 다른 키는 그대로 둔다", async () => {
    const { db, bank, card, categoryId, upload } = setup();
    upload(card, [row("(주)이마트"), row("이마트"), row("이마트24")]);
    upload(bank, [row("이마트", -2_000, { date: "2026-10-11" }), row("홈플러스", -3_000, { date: "2026-10-11" })]);
    await classifyPending(db, { classify: fakeClassifier({ "(주)이마트": "장보기", 홈플러스: "장보기" }) });
    const [first, second] = db.select().from(transactions).where(eq(transactions.description, "이마트")).all();
    // 은행 쪽 이마트는 다시 올린 셈이라 saved, 이마트24(다른 키)는 사용자가 따로 고쳤다.
    db.update(transactions).set({ categorySource: "saved" }).where(eq(transactions.id, second.id)).run();
    db.update(transactions).set({ categoryId: categoryId("외식·배달"), categorySource: "user" }).where(eq(transactions.description, "이마트24")).run();
    // 하나는 아직 미분류로 둔다.
    db.update(transactions).set({ categoryId: null, categorySource: null }).where(eq(transactions.description, "(주)이마트")).run();

    expect(setTransactionCategory(db, first.id, categoryId("생활용품"))).toEqual({ sameKeyCount: 2 });
    expect(listRows(db).map((r) => [r.description, r.category, r.source])).toEqual([
      ["(주)이마트", "생활용품", "saved"],
      ["이마트", "생활용품", "user"],
      ["이마트24", "외식·배달", "user"],
      ["이마트", "생활용품", "saved"],
      ["홈플러스", "장보기", "ai"],
    ]);
  });

  it("같은 키라도 삭제 표시한 거래는 바꾸지 않는다", async () => {
    const { db, card, categoryId, upload } = setup();
    upload(card, [row("이마트"), row("이마트", -2_000, { date: "2026-10-12" })]);
    await classifyPending(db, { classify: fakeClassifier({ 이마트: "장보기" }) });
    const [first, second] = db.select().from(transactions).where(eq(transactions.description, "이마트")).all();
    setTransactionDeleted(db, second.id, true);

    expect(setTransactionCategory(db, first.id, categoryId("생활용품"))).toEqual({ sameKeyCount: 0 });
    expect(listRows(db).map((r) => [r.category, r.source])).toEqual([
      ["생활용품", "user"],
      ["장보기", "ai"],
    ]);
  });

  it("수동 거래는 그 거래만 user로 바꾸고 규칙을 만들지 않는다", () => {
    const { db, card, categoryId, upload } = setup();
    upload(card, [row("편의점")]);
    const cash = db.insert(accounts).values({ name: "지갑", kind: "asset" }).returning().get().id;
    const id = createTransaction(db, { accountId: cash, date: "2026-11-01", time: null, amount: -1_000, description: "편의점", memo: null });
    expect(setTransactionCategory(db, id, categoryId("장보기"))).toEqual({ sameKeyCount: 0 });
    expect(listRows(db).map((r) => [r.category, r.source])).toEqual([
      [null, null],
      ["장보기", "user"],
    ]);
    expect(db.select().from(categoryRules).all()).toEqual([]);
  });

  it("이체·보정 거래와 삭제 표시한 거래는 바꿀 수 없다", () => {
    const { db, bank, card, categoryId, upload } = setup();
    const cash = db.insert(accounts).values({ name: "지갑", kind: "asset" }).returning().get().id;
    const [transferId] = createTransfer(db, { fromAccountId: bank, toAccountId: cash, date: "2026-11-01", time: null, amount: 1_000, description: "이체", memo: null });
    upload(bank, [row("이자", 100, { balanceAfter: 10_100 })]);
    upload(card, [row("지운 가게")]);
    setTransactionDeleted(db, idOf(db, "지운 가게"), true);
    const target = categoryId("기타 지출");
    expect(() => setTransactionCategory(db, transferId, target)).toThrow(/이체·보정/);
    expect(() => setTransactionCategory(db, idOf(db, "잔액 보정"), target)).toThrow(/이체·보정/);
    expect(() => setTransactionCategory(db, idOf(db, "지운 가게"), target)).toThrow(/삭제 표시/);
  });
});

describe("reclassifyOthers", () => {
  it("카테고리를 추가하고 다시 물으면 ai 규칙 중 기타 지출·기타 수입인 키만 묻고, 답이 바뀐 키의 규칙과 ai·saved 거래만 바꾼다", async () => {
    const { db, bank, card, categoryId, upload } = setup();
    upload(card, [row("별빛헤어"), row("당근페이"), row("이마트"), row("별빛헤어", -2_000, { date: "2026-10-12" }), row("동네미용실")]);
    upload(bank, [row("모르는입금", 10_000)]);
    await classifyPending(db, {
      classify: fakeClassifier({ 별빛헤어: "기타 지출", 당근페이: "기타 지출", 이마트: "장보기", 동네미용실: "기타 지출", 모르는입금: "기타 수입" }),
    });
    // 동네미용실은 사용자가 기타 지출로 확정했다(user 규칙).
    setTransactionCategory(db, idOf(db, "동네미용실"), categoryId("기타 지출"));
    // 별빛헤어 두 번째 거래는 다시 올린 셈이라 saved다.
    const [, secondHair] = db.select().from(transactions).where(eq(transactions.description, "별빛헤어")).all();
    db.update(transactions).set({ categorySource: "saved" }).where(eq(transactions.id, secondHair.id)).run();
    expect(countOtherAiRules(db)).toBe(3);

    createCategory(db, { name: "미용", group: "expense" });
    const classify = fakeClassifier({ 별빛헤어: "미용", 동네미용실: "미용", 이마트: "미용", 당근페이: "기타 지출", 모르는입금: "기타 수입" });
    expect(await reclassifyOthers(db, { classify })).toEqual({ asked: 3, changedKeys: 1, changedTransactions: 2, error: null });
    // 새 카테고리 목록으로 묻는다.
    expect(classify.mock.calls[0][1].map((c) => c.name)).toContain("미용");
    expect(sentItems(classify).map((it) => it.description)).toEqual(["별빛헤어", "당근페이", "모르는입금"]);
    expect(listRows(db).map((r) => [r.description, r.category, r.source])).toEqual([
      ["별빛헤어", "미용", "ai"],
      ["당근페이", "기타 지출", "ai"],
      ["이마트", "장보기", "ai"],
      ["별빛헤어", "미용", "saved"],
      ["동네미용실", "기타 지출", "user"],
      ["모르는입금", "기타 수입", "ai"],
    ]);
    expect(rulesOf(db)).toEqual([
      { key: "별빛헤어", category: "미용", source: "ai" },
      { key: "당근페이", category: "기타 지출", source: "ai" },
      { key: "이마트", category: "장보기", source: "ai" },
      { key: "동네미용실", category: "기타 지출", source: "user" },
      { key: "모르는입금", category: "기타 수입", source: "ai" },
    ]);
    expect(countOtherAiRules(db)).toBe(2);
  });

  it("API가 실패하거나 키가 없으면 아무것도 바꾸지 않고 이유를 돌려준다", async () => {
    const { db, card, upload } = setup();
    upload(card, [row("별빛헤어")]);
    await classifyPending(db, { classify: fakeClassifier() });
    const failing = vi.fn<Classifier>(async () => {
      throw new Error("overloaded");
    });
    expect(await reclassifyOthers(db, { classify: failing })).toEqual({
      asked: 1,
      changedKeys: 0,
      changedTransactions: 0,
      error: { kind: "failed", message: "overloaded" },
    });
    expect(await reclassifyOthers(db, { classify: null })).toEqual({ asked: 0, changedKeys: 0, changedTransactions: 0, error: { kind: "no_key" } });
    expect(listRows(db).map((r) => r.category)).toEqual(["기타 지출"]);
  });

  it("기타로 분류한 키가 없으면 API를 부르지 않는다", async () => {
    const { db, card, upload } = setup();
    upload(card, [row("이마트")]);
    await classifyPending(db, { classify: fakeClassifier({ 이마트: "장보기" }) });
    const classify = fakeClassifier();
    expect(await reclassifyOthers(db, { classify })).toEqual({ asked: 0, changedKeys: 0, changedTransactions: 0, error: null });
    expect(classify).not.toHaveBeenCalled();
  });
});
