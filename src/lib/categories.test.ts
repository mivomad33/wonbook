import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, categories, categoryRules, transactions } from "@/db/schema";
import { createCategory, deleteCategory, listCategories, listCategoryOptions, updateCategory } from "@/lib/categories";
import { countPending } from "@/lib/categorize";
import { createTransaction } from "@/lib/transactions";

type Db = ReturnType<typeof createTestDb>;

const idOf = (db: Db, name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!.id;

describe("카테고리 화면 동작", () => {
  it("추가하면 그 묶음의 맨 뒤에 들어가고, 이름이 겹치면 막는다", () => {
    const db = createTestDb();
    createCategory(db, { name: "미용", group: "expense" });
    const options = listCategoryOptions(db);
    const expense = options.filter((c) => c.group === "expense").map((c) => c.name);
    expect(expense.at(-1)).toBe("미용");
    // 묶음 순서는 지출 → 수입 → 이동
    expect(options.findIndex((c) => c.name === "미용")).toBeLessThan(options.findIndex((c) => c.name === "급여"));
    expect(() => createCategory(db, { name: "장보기", group: "income" })).toThrow(/이미 있습니다/);
  });

  it("이름·묶음을 바꾸고, 묶음을 바꾸면 새 묶음의 맨 뒤로 간다. 다른 카테고리와 이름이 겹치면 막는다", () => {
    const db = createTestDb();
    const id = idOf(db, "부수입");
    updateCategory(db, id, { name: "부수입", group: "income" });
    updateCategory(db, id, { name: "중고 판매", group: "expense" });
    const expense = listCategoryOptions(db).filter((c) => c.group === "expense");
    expect(expense.at(-1)).toEqual({ id, name: "중고 판매", group: "expense" });
    expect(() => updateCategory(db, id, { name: "장보기", group: "expense" })).toThrow(/이미 있습니다/);
  });

  it("기타 지출·기타 수입은 AI 분류에 이름으로 쓰므로 바꾸거나 지울 수 없다", () => {
    const db = createTestDb();
    for (const name of ["기타 지출", "기타 수입"]) {
      const id = idOf(db, name);
      expect(() => updateCategory(db, id, { name: "그 밖의 것", group: "expense" })).toThrow(/바꾸거나 지울 수 없습니다/);
      expect(() => deleteCategory(db, id)).toThrow(/바꾸거나 지울 수 없습니다/);
    }
    expect(listCategoryOptions(db).filter((c) => c.name.startsWith("기타")).map((c) => c.name)).toEqual(["기타 지출", "기타 수입"]);
  });

  it("지우면 거래는 미분류(카테고리와 출처 모두 null)가 되고 저장된 분류는 함께 지워진다", () => {
    const db = createTestDb();
    const account = db.insert(accounts).values({ name: "카드", kind: "card" }).returning().get().id;
    const target = idOf(db, "카페·간식");
    const keep = idOf(db, "장보기");
    const add = (description: string, categoryId: number) =>
      db
        .insert(transactions)
        .values({ accountId: account, kind: "normal", source: "upload", date: "2026-10-01", amount: -1_000, description, categoryId, categorySource: "ai" })
        .run();
    add("스타벅스", target);
    add("이마트", keep);
    db.insert(categoryRules).values([
      { matchKey: "스타벅스", categoryId: target, source: "ai", updatedAt: "2026-10-01" },
      { matchKey: "이마트", categoryId: keep, source: "user", updatedAt: "2026-10-01" },
    ]).run();
    createTransaction(db, { accountId: account, date: "2026-10-02", time: null, amount: -500, description: "현금 커피", memo: null, categoryId: target });

    const before = listCategories(db).find((c) => c.id === target)!;
    expect([before.transactionCount, before.ruleCount]).toEqual([2, 1]);

    deleteCategory(db, target);
    expect(
      db.select({ d: transactions.description, c: transactions.categoryId, s: transactions.categorySource }).from(transactions).orderBy(asc(transactions.id)).all(),
    ).toEqual([
      { d: "스타벅스", c: null, s: null },
      { d: "이마트", c: keep, s: "ai" },
      { d: "현금 커피", c: null, s: null },
    ]);
    expect(db.select({ key: categoryRules.matchKey }).from(categoryRules).all()).toEqual([{ key: "이마트" }]);
    // 미분류가 된 업로드 거래는 다시 분류 대상이다.
    expect(countPending(db)).toBe(1);
  });
});
