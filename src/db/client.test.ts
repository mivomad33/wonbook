import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestContext, createTestUser } from "@/db/test-db";
import { accounts, categories, transactions } from "@/db/schema";

// drizzle가 감싼 오류에서 Postgres 오류 메시지를 꺼낸다.
const pgMessage = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return String((e as { cause?: unknown }).cause ?? e);
  }
  return "";
};

describe("테스트 DB", () => {
  it("마이그레이션으로 테이블이 생기고 외래 키가 동작한다", async () => {
    const { db, userId } = await createTestContext();
    // 앱 DB 타입은 드라이버를 가리지 않아 execute 결과 형태를 모른다. PGlite·node-postgres 모두 rows로 준다.
    const result = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)) as unknown as {
      rows: { table_name: string }[];
    };
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "accounts",
      "categories",
      "category_rules",
      "classify_usage",
      "classify_usage_total",
      "import_undo",
      "imports",
      "sessions",
      "settings",
      "transactions",
      "upload_staging",
      "users",
    ]);
    expect(await pgMessage(db.insert(transactions).values({ userId, accountId: 9999, kind: "normal", source: "manual", date: "2026-10-01", amount: 1 }))).toMatch(
      /foreign key/,
    );
  });

  // 표현식 인덱스(coalesce)가 NULL끼리도 중복을 막는지 확인한다. 같은 이름이라도 사용자가 다르면 된다.
  it("coalesce unique index가 NULL끼리도 중복을 막는다", async () => {
    const { db, userId } = await createTestContext();
    await db.insert(accounts).values({ userId, name: "하나카드", kind: "card", institution: "hana_card" });
    expect(await pgMessage(db.insert(accounts).values({ userId, name: "하나카드 2", kind: "card", institution: "hana_card" }))).toMatch(/duplicate key/);
    // 수동 계정(금융사 없음)은 제약을 받지 않는다.
    await db.insert(accounts).values([
      { userId, name: "빌려준 돈", kind: "asset" },
      { userId, name: "빌려준 돈 2", kind: "asset" },
    ]);

    await db.insert(categories).values({ userId, name: "식비", group: "expense" });
    expect(await pgMessage(db.insert(categories).values({ userId, name: "식비", group: "expense" }))).toMatch(/duplicate key/);
    const other = await createTestUser(db);
    await db.insert(accounts).values({ userId: other, name: "하나카드", kind: "card", institution: "hana_card" });
    await db.insert(categories).values({ userId: other, name: "식비", group: "expense" });
  });
});
