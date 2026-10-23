import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, categories } from "@/db/schema";

describe("테스트 DB", () => {
  it("마이그레이션으로 테이블 6개가 생기고 외래 키가 켜진다", () => {
    const db = createTestDb();
    const tables = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`)
      .map((t) => t.name)
      .filter((name) => !name.startsWith("__drizzle") && !name.startsWith("sqlite_"));
    expect(tables).toEqual(["accounts", "categories", "category_rules", "imports", "settings", "transactions"]);
    expect(db.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)?.foreign_keys).toBe(1);
  });

  // drizzle-kit이 표현식 인덱스를 잘못 만들어 마이그레이션 SQL을 손으로 고쳤다. 고친 인덱스가 실제로 동작하는지 확인한다.
  it("coalesce unique index가 NULL끼리도 중복을 막는다", () => {
    const db = createTestDb();
    db.insert(accounts).values({ name: "하나카드", kind: "card", institution: "hana_card" }).run();
    expect(() => db.insert(accounts).values({ name: "하나카드 2", kind: "card", institution: "hana_card" }).run()).toThrow(/UNIQUE/);
    // 수동 계정(금융사 없음)은 제약을 받지 않는다.
    db.insert(accounts).values([{ name: "빌려준 돈", kind: "asset" }, { name: "빌려준 돈 2", kind: "asset" }]).run();

    db.insert(categories).values({ name: "식비", group: "expense" }).run();
    expect(() => db.insert(categories).values({ name: "식비", group: "expense" }).run()).toThrow(/UNIQUE/);
  });
});
