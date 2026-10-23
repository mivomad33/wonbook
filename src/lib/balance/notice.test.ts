import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import { accounts, transactions } from "@/db/schema";
import { dismissAdjustmentNotice, listAdjustmentNotice } from "@/lib/balance/notice";

type Db = ReturnType<typeof createTestDb>;

const addAccount = (db: Db, name: string, sortOrder = 0) =>
  db.insert(accounts).values({ name, kind: "asset", sortOrder }).returning({ id: accounts.id }).get().id;

function addAdjustment(db: Db, accountId: number, date: string, amount: number, createdAt: string) {
  db.insert(transactions)
    .values({ accountId, kind: "adjustment", source: "system", date, amount, description: "잔액 보정", createdAt })
    .run();
}

describe("잔액 보정 알림(4단계 파일 6장)", () => {
  it("닫은 시각 뒤에 생긴 보정만 계정별로 건수·합계·마지막 보정 달을 센다", () => {
    const db = createTestDb();
    const a = addAccount(db, "하나", 2);
    const b = addAccount(db, "카카오", 1);
    addAdjustment(db, a, "2026-08-03", 500, "2026-10-01T00:00:00.000Z");
    addAdjustment(db, a, "2026-09-10", -200, "2026-10-01T00:00:00.000Z");
    addAdjustment(db, b, "2026-09-01", 1_000, "2026-10-01T00:00:00.000Z");
    // 보정이 아닌 거래는 세지 않는다.
    db.insert(transactions).values({ accountId: a, kind: "normal", source: "manual", date: "2026-09-11", amount: 7 }).run();

    expect(listAdjustmentNotice(db)).toEqual([
      { accountId: b, accountName: "카카오", count: 1, total: 1_000, lastMonth: "2026-09" },
      { accountId: a, accountName: "하나", count: 2, total: 300, lastMonth: "2026-09" },
    ]);

    dismissAdjustmentNotice(db, "2026-10-02T00:00:00.000Z");
    expect(listAdjustmentNotice(db)).toEqual([]);

    addAdjustment(db, a, "2026-10-05", 50, "2026-10-03T00:00:00.000Z");
    expect(listAdjustmentNotice(db)).toEqual([{ accountId: a, accountName: "하나", count: 1, total: 50, lastMonth: "2026-10" }]);

    // 다시 닫으면 닫은 시각을 고친다.
    dismissAdjustmentNotice(db, "2026-10-04T00:00:00.000Z");
    expect(listAdjustmentNotice(db)).toEqual([]);
  });
});
