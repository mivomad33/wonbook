// 잔액 보정 알림(4단계 파일 6장). 알림에 필요한 값은 모두 transactions에서 계산하고, 닫은 시각만 settings에 둔다.
import { and, asc, count, eq, gt, max, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

const DISMISSED_KEY = "adjustment_notice_dismissed_at";

// 닫은 시각 뒤에 생긴(created_at이 더 늦은) 보정 거래를 계정마다 센다. 닫은 적이 없으면 모두 센다.
// lastMonth는 그 계정의 마지막 보정 달로, 알림에서 거래 목록으로 가는 링크에 쓴다.
export function listAdjustmentNotice(db: Db) {
  const dismissedAt = getSetting<string>(db, DISMISSED_KEY);
  return db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      count: count(),
      total: sum(transactions.amount).mapWith(Number),
      lastDate: max(transactions.date),
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.kind, "adjustment"), dismissedAt ? gt(transactions.createdAt, dismissedAt) : undefined))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.sortOrder), asc(accounts.id))
    .all()
    .map(({ lastDate, ...r }) => ({ ...r, lastMonth: lastDate!.slice(0, 7) }));
}

export type AdjustmentNoticeItem = ReturnType<typeof listAdjustmentNotice>[number];

// "닫기"(6.3). 지금까지 생긴 보정은 다시 알리지 않는다.
export function dismissAdjustmentNotice(db: Db, now = new Date().toISOString()) {
  setSetting(db, DISMISSED_KEY, now);
}
