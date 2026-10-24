import { describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, categories, categoryRules, transactions } from "@/db/schema";
import { applyImport, undoImport, type UploadedTransaction } from "@/lib/import";
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

const row = (description: string, amount = -1_000, extra: Partial<UploadedTransaction> = {}): UploadedTransaction => ({
  date: "2026-10-10",
  time: null,
  amount,
  description,
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
  ...extra,
});

async function addAccount(db: Db, userId: number, values: Omit<typeof accounts.$inferInsert, "userId">) {
  return (await db.insert(accounts).values({ userId, ...values }).returning())[0].id;
}

async function setup() {
  const { db, userId } = await createTestContext();
  const card = await addAccount(db, userId, { name: "하나카드", kind: "card", institution: "hana_card" });
  const bank = await addAccount(db, userId, { name: "하나", kind: "asset", institution: "hana_bank", openingBalance: 0 });
  // 카테고리 id는 미리 읽어 두고 동기로 꺼낸다.
  const ids = new Map((await db.select().from(categories).where(eq(categories.userId, userId))).map((c) => [c.name, c.id]));
  const categoryId = (name: string) => ids.get(name)!;
  const upload = async (accountId: number, rows: UploadedTransaction[]) => {
    const result = await applyImport(db, userId, {
      accountId,
      fileName: "파일",
      file: {
        institution: accountId === card ? "hana_card" : "hana_bank",
        period: { start: "2026-10-01", end: "2026-10-31" },
        transactions: rows,
      },
      confirmedIds: [],
    });
    if (result.status !== "applied") throw new Error("반영되지 않았습니다.");
    return result.importId;
  };
  return { db, userId, card, bank, categoryId, upload };
}

// 한도를 세지 않는 분류(한도는 quota.test.ts)
const noQuota = { quota: null };
const ok = { limited: false, limitedKeys: 0 };

// 문구에 따라 답하는 가짜 Claude API. 답을 정하지 않은 문구는 "기타 지출"이다.
function fakeClassifier(answers: Record<string, string> = {}) {
  return vi.fn<Classifier>(async (items) => new Map(items.map((it) => [it.id, answers[it.description ?? it.method ?? ""] ?? "기타 지출"])));
}

const listRows = (db: Db, userId: number) =>
  db
    .select({
      description: transactions.description,
      kind: transactions.kind,
      category: categories.name,
      source: transactions.categorySource,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.id));

const sentItems = (classify: ReturnType<typeof fakeClassifier>): ClassifyItem[] => classify.mock.calls.flatMap((c) => c[0]);

describe("처음 카테고리", () => {
  it("마이그레이션으로 버전 B 25개가 묶음 순서대로 들어 있다", async () => {
    const { db, userId } = await setup();
    const infos = await listCategoryInfos(db, userId);
    expect(infos).toHaveLength(25);
    expect(infos.filter((c) => c.group === "expense")).toHaveLength(16);
    expect(infos.filter((c) => c.group === "income")).toHaveLength(6);
    expect(infos.filter((c) => c.group === "move").map((c) => c.name)).toEqual(["카드대금", "내 계좌·페이 이동", "개인 송금"]);
    expect(infos[0]).toEqual({ name: "장보기", group: "expense" });
  });
});

describe("classifyPending", () => {
  it("저장된 분류는 반영할 때 saved로, 나머지는 API 결과로 ai가 붙고 규칙으로 저장된다", async () => {
    const { db, userId, card, categoryId, upload } = await setup();
    await db.insert(categoryRules).values({ userId, matchKey: "스타벅스", categoryId: categoryId("카페·간식"), source: "ai", updatedAt: "2026-10-01" });
    const importId = await upload(card, [row("스타벅스"), row("이마트"), row("(주)이마트"), row("김밥천국")]);
    // 반영만 했을 때: 규칙이 있는 거래만 saved
    expect((await listRows(db, userId)).map((r) => r.source)).toEqual(["saved", null, null, null]);

    const classify = fakeClassifier({ 이마트: "장보기", 김밥천국: "외식·배달" });
    const result = await classifyPending(db, userId, { ...noQuota, classify, importIds: [importId] });
    expect(result).toEqual({ saved: 0, ai: 3, pending: 0, error: null, ...ok });
    expect((await listRows(db, userId)).map((r) => [r.description, r.category, r.source])).toEqual([
      ["스타벅스", "카페·간식", "saved"],
      ["이마트", "장보기", "ai"],
      ["(주)이마트", "장보기", "ai"],
      ["김밥천국", "외식·배달", "ai"],
    ]);
    // 같은 키(이마트, (주)이마트)는 한 번만 묻는다.
    expect(classify).toHaveBeenCalledTimes(1);
    expect(sentItems(classify).map((it) => it.description)).toEqual(["이마트", "김밥천국"]);
    expect((await db.select({ key: categoryRules.matchKey, source: categoryRules.source }).from(categoryRules))).toEqual([
      { key: "스타벅스", source: "ai" },
      { key: "이마트", source: "ai" },
      { key: "김밥천국", source: "ai" },
    ]);
    expect((await categoryCountsByImport(db, userId, [importId])).get(importId)).toEqual({ saved: 1, ai: 3, pending: 0 });

    // 다시 올리면 모두 저장된 분류로 붙고 API를 부르지 않는다.
    const again = await upload(card, [row("스타벅스"), row("이마트"), row("(주)이마트"), row("김밥천국")]);
    const second = fakeClassifier();
    expect(await classifyPending(db, userId, { ...noQuota, classify: second, importIds: [again] })).toEqual({ saved: 0, ai: 0, pending: 0, error: null, ...ok });
    expect(second).not.toHaveBeenCalled();
    expect((await listRows(db, userId)).map((r) => r.source)).toEqual(["saved", "saved", "saved", "saved"]);
  });

  it("보낼 칸: 문구·방향·방식·계정 종류만 보내고, method로 만든 키는 문구 원문을 보내지 않는다", async () => {
    const { db, userId, card, bank, upload } = await setup();
    const ids = [
      await upload(card, [row("쿠팡", 5_000, { method: "일시불", memo: "메모", cardLabel: "본인 1234" })]),
      await upload(bank, [row("123-456789-01", -100_000, { method: "청약종합" })]),
    ];
    const classify = fakeClassifier();
    await classifyPending(db, userId, { ...noQuota, classify, importIds: ids });
    expect(sentItems(classify)).toEqual([
      { id: "1", description: "쿠팡", direction: "in", method: "일시불", account: "card" },
      { id: "2", description: null, direction: "out", method: "청약종합", account: "bank" },
    ]);
  });

  it("user 규칙은 반영 때 붙고, API를 기다리는 사이 생긴 규칙도 AI 결과가 덮어쓰지 않는다", async () => {
    const { db, userId, card, categoryId, upload } = await setup();
    await db.insert(categoryRules).values({ userId, matchKey: "다이소", categoryId: categoryId("생활용품"), source: "user", updatedAt: "2026-10-01" });
    const importId = await upload(card, [row("다이소"), row("올리브영")]);
    const classify = vi.fn<Classifier>(async (items) => {
      // 그사이 사용자가 올리브영을 고쳤다.
      await db.insert(categoryRules).values({ userId, matchKey: "올리브영", categoryId: categoryId("쇼핑·의류"), source: "user", updatedAt: "2026-10-02" });
      return new Map(items.map((it) => [it.id, "기타 지출"]));
    });
    const result = await classifyPending(db, userId, { ...noQuota, classify, importIds: [importId] });
    expect(result).toEqual({ saved: 1, ai: 0, pending: 0, error: null, ...ok });
    expect((await listRows(db, userId)).map((r) => [r.category, r.source])).toEqual([
      ["생활용품", "saved"],
      ["쇼핑·의류", "saved"],
    ]);
    expect((await db.select({ source: categoryRules.source }).from(categoryRules).where(eq(categoryRules.matchKey, "올리브영")))[0]).toEqual({ source: "user" });
  });

  it("목록 밖의 답과 답이 없는 id는 미분류로 두고 규칙을 만들지 않는다", async () => {
    const { db, userId, card, upload } = await setup();
    const importId = await upload(card, [row("가게하나"), row("가게둘"), row("가게셋")]);
    const classify = vi.fn<Classifier>(async () => new Map([["1", "없는 카테고리"], ["3", "장보기"]]));
    expect(await classifyPending(db, userId, { ...noQuota, classify, importIds: [importId] })).toEqual({ saved: 0, ai: 1, pending: 2, error: null, ...ok });
    expect((await listRows(db, userId)).map((r) => r.category)).toEqual([null, null, "장보기"]);
    expect((await db.select().from(categoryRules))).toHaveLength(1);
  });

  it("API가 실패한 묶음은 미분류로 두고 이유를 돌려주며, 다른 묶음은 분류한다", async () => {
    const { db, userId, card, upload } = await setup();
    // 키가 묶음 크기보다 하나 많아 두 번 묻는다. 숫자는 키에서 지워지므로 영문으로 다르게 만든다.
    const names = Array.from({ length: CLASSIFY_BATCH + 1 }, (_, i) => `SHOP${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    const importId = await upload(card, names.map((n) => row(n)));
    let call = 0;
    const classify = vi.fn<Classifier>(async (items) => {
      if (call++ === 0) throw new Error("overloaded");
      return new Map(items.map((it) => [it.id, "기타 지출"]));
    });
    const result = await classifyPending(db, userId, { ...noQuota, classify, importIds: [importId] });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ saved: 0, ai: 1, pending: CLASSIFY_BATCH, error: { kind: "failed", message: "overloaded" }, ...ok });
  });

  it("API 키가 없으면 저장된 분류만 붙이고 이유를 돌려준다", async () => {
    const { db, userId, card, upload } = await setup();
    const importId = await upload(card, [row("이마트")]);
    expect(await classifyPending(db, userId, { ...noQuota, classify: null, importIds: [importId] })).toEqual({ saved: 0, ai: 0, pending: 1, error: { kind: "no_key" }, ...ok });
  });

  it("이체·보정·수동 거래와 삭제 표시한 거래에는 붙이지 않는다", async () => {
    const { db, userId, bank, card, upload } = await setup();
    const cash = await addAccount(db, userId, { name: "지갑", kind: "asset" });
    await createTransaction(db, userId, { accountId: cash, date: "2026-11-01", time: null, amount: -1_000, description: "현금", memo: null });
    await createTransfer(db, userId, { fromAccountId: bank, toAccountId: cash, date: "2026-11-01", time: null, amount: 1_000, description: "이체", memo: null });
    // 기초 잔액 0인데 실제 잔액이 1만 원이라 보정 거래가 생긴다.
    await upload(bank, [row("이자", 100, { balanceAfter: 10_100 })]);
    await upload(card, [row("이마트"), row("지운 가게")]);
    await setTransactionDeleted(db, userId, (await db.select().from(transactions).where(eq(transactions.description, "지운 가게")))[0].id, true);
    const classify = fakeClassifier({ 이자: "이자·배당", 이마트: "장보기" });
    await classifyPending(db, userId, { ...noQuota, classify });
    expect((await listRows(db, userId)).map((r) => [r.kind, r.description, r.category])).toEqual([
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
    const { db, userId, bank, card, categoryId, upload } = await setup();
    // 처음에는 API 키가 없어 두 업로드 모두 미분류로 남았다.
    const ids = [await upload(card, [row("이마트"), row("김밥천국")]), await upload(bank, [row("홍길동", 50_000)])];
    await classifyPending(db, userId, { ...noQuota, classify: null, importIds: ids });
    expect(await countPending(db, userId)).toBe(3);
    // 그중 하나는 사용자가 골랐다.
    await db.update(transactions)
      .set({ categoryId: categoryId("외식·배달"), categorySource: "user" })
      .where(eq(transactions.description, "김밥천국"));

    const classify = fakeClassifier({ 이마트: "장보기", 홍길동: "개인 송금", 김밥천국: "기타 지출" });
    expect(await classifyPending(db, userId, { ...noQuota, classify })).toEqual({ saved: 0, ai: 2, pending: 0, error: null, ...ok });
    expect(sentItems(classify).map((it) => it.description)).toEqual(["이마트", "홍길동"]);
    expect((await listRows(db, userId)).map((r) => [r.description, r.category, r.source])).toEqual([
      ["이마트", "장보기", "ai"],
      ["김밥천국", "외식·배달", "user"],
      ["홍길동", "개인 송금", "ai"],
    ]);
    expect(await countPending(db, userId)).toBe(0);
  });
});

const idOf = async (db: Db, userId: number, description: string) =>
  (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.description, description))))[0].id;
const rulesOf = (db: Db, userId: number) =>
  db
    .select({ key: categoryRules.matchKey, category: categories.name, source: categoryRules.source })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.userId, userId))
    .orderBy(asc(categoryRules.id));

describe("setTransactionCategory", () => {
  it("업로드 거래를 바꾸면 거래와 규칙이 user가 되고 edited_at은 그대로다. 다시 올린 거래에도 바꾼 카테고리가 붙는다", async () => {
    const { db, userId, card, categoryId, upload } = await setup();
    await upload(card, [row("다이소"), row("올리브영")]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier({ 다이소: "장보기", 올리브영: "생활용품" }) });

    expect(await setTransactionCategory(db, userId, await idOf(db, userId, "다이소"), categoryId("생활용품"))).toEqual({ sameKeyCount: 0 });
    const changed = (await db.select().from(transactions).where(eq(transactions.description, "다이소")))[0];
    expect([changed.categorySource, changed.editedAt]).toEqual(["user", null]);
    expect(await rulesOf(db, userId)).toEqual([
      { key: "다이소", category: "생활용품", source: "user" },
      { key: "올리브영", category: "생활용품", source: "ai" },
    ]);

    // 같은 기간을 다시 올려도(손댄 거래가 아니라 확인 없이 덮어쓴다) 바꾼 카테고리가 붙는다.
    await upload(card, [row("다이소"), row("올리브영")]);
    expect((await listRows(db, userId)).map((r) => [r.description, r.category, r.source])).toEqual([
      ["다이소", "생활용품", "saved"],
      ["올리브영", "생활용품", "saved"],
    ]);
  });

  it("같은 키의 saved·ai·미분류 거래도 함께 바꾸고, user 거래와 다른 키는 그대로 둔다", async () => {
    const { db, userId, bank, card, categoryId, upload } = await setup();
    await upload(card, [row("(주)이마트"), row("이마트"), row("이마트24")]);
    await upload(bank, [row("이마트", -2_000, { date: "2026-10-11" }), row("홈플러스", -3_000, { date: "2026-10-11" })]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier({ "(주)이마트": "장보기", 홈플러스: "장보기" }) });
    const [first, second] = (await db.select().from(transactions).where(eq(transactions.description, "이마트")));
    // 은행 쪽 이마트는 다시 올린 셈이라 saved, 이마트24(다른 키)는 사용자가 따로 고쳤다.
    await db.update(transactions).set({ categorySource: "saved" }).where(eq(transactions.id, second.id));
    await db.update(transactions).set({ categoryId: categoryId("외식·배달"), categorySource: "user" }).where(eq(transactions.description, "이마트24"));
    // 하나는 아직 미분류로 둔다.
    await db.update(transactions).set({ categoryId: null, categorySource: null }).where(eq(transactions.description, "(주)이마트"));

    expect(await setTransactionCategory(db, userId, first.id, categoryId("생활용품"))).toEqual({ sameKeyCount: 2 });
    expect((await listRows(db, userId)).map((r) => [r.description, r.category, r.source])).toEqual([
      ["(주)이마트", "생활용품", "saved"],
      ["이마트", "생활용품", "user"],
      ["이마트24", "외식·배달", "user"],
      ["이마트", "생활용품", "saved"],
      ["홈플러스", "장보기", "ai"],
    ]);
  });

  it("같은 키라도 삭제 표시한 거래는 바꾸지 않는다", async () => {
    const { db, userId, card, categoryId, upload } = await setup();
    await upload(card, [row("이마트"), row("이마트", -2_000, { date: "2026-10-12" })]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier({ 이마트: "장보기" }) });
    const [first, second] = (await db.select().from(transactions).where(eq(transactions.description, "이마트")));
    await setTransactionDeleted(db, userId, second.id, true);

    expect(await setTransactionCategory(db, userId, first.id, categoryId("생활용품"))).toEqual({ sameKeyCount: 0 });
    expect((await listRows(db, userId)).map((r) => [r.category, r.source])).toEqual([
      ["생활용품", "user"],
      ["장보기", "ai"],
    ]);
  });

  it("수동 거래는 그 거래만 user로 바꾸고 규칙을 만들지 않는다", async () => {
    const { db, userId, card, categoryId, upload } = await setup();
    await upload(card, [row("편의점")]);
    const cash = await addAccount(db, userId, { name: "지갑", kind: "asset" });
    const id = await createTransaction(db, userId, { accountId: cash, date: "2026-11-01", time: null, amount: -1_000, description: "편의점", memo: null });
    expect(await setTransactionCategory(db, userId, id, categoryId("장보기"))).toEqual({ sameKeyCount: 0 });
    expect((await listRows(db, userId)).map((r) => [r.category, r.source])).toEqual([
      [null, null],
      ["장보기", "user"],
    ]);
    expect((await db.select().from(categoryRules))).toEqual([]);
  });

  it("이체·보정 거래와 삭제 표시한 거래는 바꿀 수 없다", async () => {
    const { db, userId, bank, card, categoryId, upload } = await setup();
    const cash = await addAccount(db, userId, { name: "지갑", kind: "asset" });
    const [transferId] = await createTransfer(db, userId, { fromAccountId: bank, toAccountId: cash, date: "2026-11-01", time: null, amount: 1_000, description: "이체", memo: null });
    await upload(bank, [row("이자", 100, { balanceAfter: 10_100 })]);
    await upload(card, [row("지운 가게")]);
    await setTransactionDeleted(db, userId, await idOf(db, userId, "지운 가게"), true);
    const target = categoryId("기타 지출");
    await expect(setTransactionCategory(db, userId, transferId, target)).rejects.toThrow(/이체·보정/);
    await expect(setTransactionCategory(db, userId, await idOf(db, userId, "잔액 보정"), target)).rejects.toThrow(/이체·보정/);
    await expect(setTransactionCategory(db, userId, await idOf(db, userId, "지운 가게"), target)).rejects.toThrow(/삭제 표시/);
  });
});

describe("reclassifyOthers", () => {
  it("카테고리를 추가하고 다시 물으면 ai 규칙 중 기타 지출·기타 수입인 키만 묻고, 답이 바뀐 키의 규칙과 ai·saved 거래만 바꾼다", async () => {
    const { db, userId, bank, card, categoryId, upload } = await setup();
    await upload(card, [row("별빛헤어"), row("당근페이"), row("이마트"), row("별빛헤어", -2_000, { date: "2026-10-12" }), row("동네미용실")]);
    await upload(bank, [row("모르는입금", 10_000)]);
    await classifyPending(db, userId, {
      ...noQuota,
      classify: fakeClassifier({ 별빛헤어: "기타 지출", 당근페이: "기타 지출", 이마트: "장보기", 동네미용실: "기타 지출", 모르는입금: "기타 수입" }),
    });
    // 동네미용실은 사용자가 기타 지출로 확정했다(user 규칙).
    await setTransactionCategory(db, userId, await idOf(db, userId, "동네미용실"), categoryId("기타 지출"));
    // 별빛헤어 두 번째 거래는 다시 올린 셈이라 saved다.
    const [, secondHair] = (await db.select().from(transactions).where(eq(transactions.description, "별빛헤어")));
    await db.update(transactions).set({ categorySource: "saved" }).where(eq(transactions.id, secondHair.id));
    expect(await countOtherAiRules(db, userId)).toBe(3);

    await createCategory(db, userId, { name: "미용", group: "expense" });
    const classify = fakeClassifier({ 별빛헤어: "미용", 동네미용실: "미용", 이마트: "미용", 당근페이: "기타 지출", 모르는입금: "기타 수입" });
    expect(await reclassifyOthers(db, userId, { ...noQuota, classify })).toEqual({ asked: 3, changedKeys: 1, changedTransactions: 2, error: null, ...ok });
    // 새 카테고리 목록으로 묻는다.
    expect(classify.mock.calls[0][1].map((c) => c.name)).toContain("미용");
    expect(sentItems(classify).map((it) => it.description)).toEqual(["별빛헤어", "당근페이", "모르는입금"]);
    expect((await listRows(db, userId)).map((r) => [r.description, r.category, r.source])).toEqual([
      ["별빛헤어", "미용", "ai"],
      ["당근페이", "기타 지출", "ai"],
      ["이마트", "장보기", "ai"],
      ["별빛헤어", "미용", "saved"],
      ["동네미용실", "기타 지출", "user"],
      ["모르는입금", "기타 수입", "ai"],
    ]);
    expect(await rulesOf(db, userId)).toEqual([
      { key: "별빛헤어", category: "미용", source: "ai" },
      { key: "당근페이", category: "기타 지출", source: "ai" },
      { key: "이마트", category: "장보기", source: "ai" },
      { key: "동네미용실", category: "기타 지출", source: "user" },
      { key: "모르는입금", category: "기타 수입", source: "ai" },
    ]);
    expect(await countOtherAiRules(db, userId)).toBe(2);
  });

  it("API가 실패하거나 키가 없으면 아무것도 바꾸지 않고 이유를 돌려준다", async () => {
    const { db, userId, card, upload } = await setup();
    await upload(card, [row("별빛헤어")]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier() });
    const failing = vi.fn<Classifier>(async () => {
      throw new Error("overloaded");
    });
    expect(await reclassifyOthers(db, userId, { ...noQuota, classify: failing })).toEqual({
      asked: 1,
      changedKeys: 0,
      changedTransactions: 0,
      error: { kind: "failed", message: "overloaded" },
      ...ok,
    });
    expect(await reclassifyOthers(db, userId, { ...noQuota, classify: null })).toEqual({ asked: 0, changedKeys: 0, changedTransactions: 0, error: { kind: "no_key" }, ...ok });
    expect((await listRows(db, userId)).map((r) => r.category)).toEqual(["기타 지출"]);
  });

  it("업로드를 되돌려 거래가 남지 않은 키는 세지도 묻지도 않는다", async () => {
    const { db, userId, card, bank, upload } = await setup();
    await upload(bank, [row("모르는입금", 10_000)]);
    const importId = await upload(card, [row("별빛헤어")]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier({ 모르는입금: "기타 수입" }) });
    await undoImport(db, userId, importId);
    // 별빛헤어 규칙은 남지만 물을 거래가 없다.
    expect((await rulesOf(db, userId)).map((r) => r.key)).toContain("별빛헤어");
    expect(await countOtherAiRules(db, userId)).toBe(1);
    const classify = fakeClassifier();
    expect(await reclassifyOthers(db, userId, { ...noQuota, classify })).toMatchObject({ asked: 1 });
  });

  it("기타로 분류한 키가 없으면 API를 부르지 않는다", async () => {
    const { db, userId, card, upload } = await setup();
    await upload(card, [row("이마트")]);
    await classifyPending(db, userId, { ...noQuota, classify: fakeClassifier({ 이마트: "장보기" }) });
    const classify = fakeClassifier();
    expect(await reclassifyOthers(db, userId, { ...noQuota, classify })).toEqual({ asked: 0, changedKeys: 0, changedTransactions: 0, error: null, ...ok });
    expect(classify).not.toHaveBeenCalled();
  });
});
