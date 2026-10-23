// 잔액 계산(design.md 1.3-D). 계정 관리, 자산 현황, 거래 목록 요약(2단계)과 보정 거래(4단계)가 쓴다.
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { accounts, transactions } from "@/db/schema";

// 잔액 = opening_balance + (date > opening_date이고 삭제 표시 안 된 거래의 amount 합). opening_date가 null이면 모두 더한다.
// 저장값 그대로 돌려준다(부채는 음수). 화면에서는 toDisplayBalance로 뒤집는다.
// 카드 계정은 잔액을 쓰지 않으므로 결과에 넣지 않는다(design.md 1.4).
export function getBalances(db: Db, accountIds?: number[]): Map<number, number> {
  const rows = db
    .select({
      id: accounts.id,
      balance: sql<number>`${accounts.openingBalance} + coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, accounts.id),
        isNull(transactions.deletedAt),
        or(isNull(accounts.openingDate), gt(transactions.date, accounts.openingDate)),
      ),
    )
    .where(and(ne(accounts.kind, "card"), accountIds ? inArray(accounts.id, accountIds) : undefined))
    .groupBy(accounts.id)
    .all();
  return new Map(rows.map((r) => [r.id, r.balance]));
}

export function getBalance(db: Db, accountId: number): number | undefined {
  return getBalances(db, [accountId]).get(accountId);
}

// 날짜로 끊은 잔액: 위 식에 date < before 조건을 더한다(4단계 파일 3.4). 보정 계산의 기간 시작 직전 잔액에 쓴다.
// 덮어쓸 기간 뒤에 남은 거래까지 더하지 않기 위해 getBalances와 따로 둔다.
export function getBalanceBefore(db: DbOrTx, accountId: number, before: string): number {
  const row = db
    .select({ balance: sql<number>`${accounts.openingBalance} + coalesce(sum(${transactions.amount}), 0)` })
    .from(accounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, accounts.id),
        isNull(transactions.deletedAt),
        or(isNull(accounts.openingDate), gt(transactions.date, accounts.openingDate)),
        lt(transactions.date, before),
      ),
    )
    .where(eq(accounts.id, accountId))
    .groupBy(accounts.id)
    .get();
  if (!row) throw new Error(`계정 ${accountId}이(가) 없습니다.`);
  return row.balance;
}

export type BalanceCheckRow = { date: string; amount: number; balanceAfter: number | null };

// 보정 거래 하나. afterIndex는 끼울 위치로, 입력 rows에서 그날 마지막 거래의 index다.
export type Adjustment = { date: string; amount: number; balanceAfter: number; afterIndex: number };

// 날마다 비교하는 보정 계산(4단계 파일 3.1·3.2). DB 없이 계산한다.
// rows는 파일 거래(오래된 순). 거래가 있는 날마다 그날 마지막 balance_after와 그때까지의 계산 잔액을 비교해,
// 다르면 차액(실제 − 계산)만큼 보정을 그날 마지막 거래 뒤에 넣는다. 기준일 당일과 그 이전 날은 더하지도 비교하지도 않는다.
export function computeAdjustments(args: {
  startBalance: number;
  openingDate: string | null;
  rows: readonly BalanceCheckRow[];
}): Adjustment[] {
  const { openingDate, rows } = args;
  const counted = (date: string) => openingDate == null || date > openingDate;
  const result: Adjustment[] = [];
  let balance = args.startBalance;
  // 그날 balance_after가 있는 마지막 거래까지의 계산 잔액과 그 실제 잔액
  let check: { computed: number; actual: number } | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!counted(row.date)) continue;
    balance += row.amount;
    if (row.balanceAfter != null) check = { computed: balance, actual: row.balanceAfter };
    if (rows[i + 1]?.date === row.date) continue;
    // 그날 마지막 거래. 그날 balance_after가 모두 없으면 비교하지 않는다.
    if (check && check.actual !== check.computed) {
      const amount = check.actual - check.computed;
      result.push({ date: row.date, amount, balanceAfter: check.actual, afterIndex: i });
      balance += amount;
    }
    check = null;
  }
  return result;
}
