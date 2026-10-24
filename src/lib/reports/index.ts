// 월별 수입/지출과 자산 현황 집계(6단계 파일 2·4·5장).
// SQL에서 계정 종류·카테고리·부호로 묶어 합을 구하고, 나누기·정렬·비율은 아래 순수 함수로 한다.
import { and, eq, gte, isNull, lt, max, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, categories, imports, type Institution, transactions } from "@/db/schema";
import { listAccounts } from "@/lib/accounts";
import { currentMonth, shiftMonth, toDisplayBalance } from "@/lib/format";
import { countAll } from "@/lib/sql";

export const UNCATEGORIZED_NAME = "미분류";

// 구성 한 줄. categoryId null은 미분류다(color도 null). color는 카테고리 색 이름이다(lib/category-style.ts).
export type ReportLine = { categoryId: number | null; name: string; color: string | null; amount: number; ratio: number | null };
// 이동 표 한 줄. inflow는 양수 합, outflow는 음수 합의 부호를 뒤집은 값이다.
export type MoveLine = { categoryId: number; name: string; color: string | null; inflow: number; outflow: number };

export type MonthlyReport = {
  account: {
    income: number;
    expense: number;
    incomeByCategory: ReportLine[];
    expenseByCategory: ReportLine[];
    moves: MoveLine[];
    adjustments: { count: number; total: number };
  };
  card: { total: number; payments: number; refunds: number; byCategory: ReportLine[] };
};

// 비율은 정수 퍼센트로 반올림한다. 금액이 0 이하인 줄과 합계가 0 이하인 구성은 비운다(6단계 파일 2장).
export function ratioOf(amount: number, total: number): number | null {
  if (amount <= 0 || total <= 0) return null;
  return Math.round((amount / total) * 100);
}

// 남은 돈이 수입의 몇 %인지(design-refresh 명세서 4.3-1). 수입이 0 이하이거나 남은 돈이 음수면 비운다.
export function leftoverRatio(income: number, expense: number): number | null {
  if (income <= 0 || income - expense < 0) return null;
  return Math.round(((income - expense) / income) * 100);
}

// 카테고리별 금액을 구성 줄로 만든다. 같은 카테고리는 합치고, 0인 줄은 뺀다.
// 금액이 큰 순, 미분류는 맨 아래. 금액이 같으면 이름 순이다.
export function buildLines(
  entries: readonly { categoryId: number | null; name: string; color?: string | null; amount: number }[],
): ReportLine[] {
  const merged = new Map<number | null, { categoryId: number | null; name: string; color: string | null; amount: number }>();
  for (const e of entries) {
    const found = merged.get(e.categoryId);
    if (found) found.amount += e.amount;
    else
      merged.set(e.categoryId, {
        categoryId: e.categoryId,
        name: e.categoryId == null ? UNCATEGORIZED_NAME : e.name,
        color: e.categoryId == null ? null : (e.color ?? null),
        amount: e.amount,
      });
  }
  const lines = [...merged.values()].filter((l) => l.amount !== 0);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return lines
    .sort(
      (a, b) =>
        Number(a.categoryId == null) - Number(b.categoryId == null) || b.amount - a.amount || a.name.localeCompare(b.name, "ko"),
    )
    .map((l) => ({ ...l, ratio: ratioOf(l.amount, total) }));
}

const sum = (lines: readonly { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

// 그 달(`YYYY-MM`) 거래 조건. 거래 목록과 같은 날짜 조건이다.
function monthRange(month: string) {
  return and(gte(transactions.date, `${month}-01`), lt(transactions.date, `${shiftMonth(month, 1)}-01`));
}

// 그 사용자의 거래만 집계한다(4.2-2).
export async function getMonthlyReport(db: DbOrTx, userId: number, month: string): Promise<MonthlyReport> {
  const isCard = sql<boolean>`${accounts.kind} = 'card'`;
  const positive = sql<boolean>`${transactions.amount} > 0`;
  // 삭제 표시 안 된 일반 거래를 (카드 여부, 카테고리, 부호)로 묶는다. 이체·보정은 넣지 않는다(1.1·1.2).
  // Postgres는 select의 칸이 모두 group by에 있어야 해서 카테고리 이름·묶음도 넣는다(카테고리 id로 정해지는 값이다).
  const rows = (
    await db
      .select({
        isCard,
        positive,
        categoryId: transactions.categoryId,
        name: categories.name,
        group: categories.group,
        color: categories.color,
        amount: sql<number>`sum(${transactions.amount})`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.kind, "normal"), monthRange(month)))
      .groupBy(isCard, transactions.categoryId, categories.name, categories.group, categories.color, positive)
  ).map((r) => ({ ...r, isCard: Boolean(r.isCard), positive: Boolean(r.positive), name: r.name ?? UNCATEGORIZED_NAME }));

  // 계정 부분: 이동 묶음은 이동 표로 빼고, 나머지를 부호로 수입·지출로 나눈다(1.4·1.5).
  const accountRows = rows.filter((r) => !r.isCard);
  const moveMap = new Map<number, MoveLine>();
  for (const r of accountRows) {
    if (r.group !== "move" || r.categoryId == null) continue;
    const line = moveMap.get(r.categoryId) ?? { categoryId: r.categoryId, name: r.name, color: r.color, inflow: 0, outflow: 0 };
    if (r.positive) line.inflow += r.amount;
    else line.outflow -= r.amount;
    moveMap.set(r.categoryId, line);
  }
  const moves = [...moveMap.values()].sort(
    (a, b) => b.inflow + b.outflow - (a.inflow + a.outflow) || a.name.localeCompare(b.name, "ko"),
  );
  const flows = accountRows.filter((r) => r.group !== "move");
  const incomeByCategory = buildLines(flows.filter((r) => r.positive));
  const expenseByCategory = buildLines(flows.filter((r) => !r.positive).map((r) => ({ ...r, amount: -r.amount })));

  // 잔액 보정: 같은 달 자산·부채 계정의 보정 거래 건수와 합(1.2)
  const [adjustment = { count: 0, total: 0 }] = await db
    .select({ count: countAll(), total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.kind, "adjustment"),
        sql`${accounts.kind} <> 'card'`,
        monthRange(month),
      ),
    );

  // 카드 부분: 카테고리마다 결제·환불을 합친 순액(1.5, 결정 G4). 이동 묶음도 나누지 않는다.
  const cardRows = rows.filter((r) => r.isCard);
  // -합은 0에서 -0이 되므로 0 − 합으로 뒤집는다.
  const payments = 0 - cardRows.filter((r) => !r.positive).reduce((s, r) => s + r.amount, 0);
  const refunds = cardRows.filter((r) => r.positive).reduce((s, r) => s + r.amount, 0);

  return {
    account: {
      income: sum(incomeByCategory),
      expense: sum(expenseByCategory),
      incomeByCategory,
      expenseByCategory,
      moves,
      adjustments: { count: adjustment.count, total: adjustment.total },
    },
    card: {
      total: payments - refunds,
      payments,
      refunds,
      byCategory: buildLines(cardRows.map((r) => ({ ...r, amount: -r.amount }))),
    },
  };
}

export type MonthTotals = { month: string; income: number; expense: number; card: number };

/**
 * 고른 달까지 최근 count개 달의 계정 수입·지출과 카드 사용(design-refresh 명세서 4.3-2).
 * 값은 getMonthlyReport의 account.income·account.expense·card.total과 같은 규칙이고, 질의 한 번으로 모든 달을 센다.
 * 거래가 없는 달은 0이다. 오래된 달부터 돌려준다.
 */
export async function getMonthlyTrend(db: DbOrTx, userId: number, month: string, count = 6): Promise<MonthTotals[]> {
  const months = Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
  const ym = sql<string>`left(${transactions.date}, 7)`;
  const isCard = sql<boolean>`${accounts.kind} = 'card'`;
  const isMove = sql<boolean>`coalesce(${categories.group} = 'move', false)`;
  const positive = sql<boolean>`${transactions.amount} > 0`;
  const rows = await db
    .select({ ym, isCard, isMove, positive, amount: sql<number>`sum(${transactions.amount})`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.kind, "normal"),
        gte(transactions.date, `${months[0]}-01`),
        lt(transactions.date, `${shiftMonth(month, 1)}-01`),
      ),
    )
    .groupBy(ym, isCard, isMove, positive);
  const totals = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0, card: 0 }]));
  for (const r of rows) {
    const t = totals.get(r.ym);
    if (!t) continue;
    // 카드는 결제(−)와 환불(+)을 합친 사용액, 계정은 이동 묶음을 빼고 부호로 나눈다(getMonthlyReport와 같다).
    if (r.isCard) t.card -= r.amount;
    else if (r.isMove) continue;
    else if (r.positive) t.income += r.amount;
    else t.expense -= r.amount;
  }
  // -0을 0으로 맞춘다.
  return months.map((m) => {
    const t = totals.get(m)!;
    return { month: m, income: t.income + 0, expense: t.expense + 0, card: t.card + 0 };
  });
}

export type AssetRow = {
  id: number;
  name: string;
  institution: Institution | null;
  // 화면에 보일 값(부채는 부호를 뒤집은 값)
  balance: number;
  // 업로드 기록 중 가장 늦은 period_end. 업로드가 없으면 null(6단계 파일 4.1).
  lastPeriodEnd: string | null;
};
// monthUsage: 이번 달 그 카드의 사용액(결제 − 환불, 월별 화면의 카드 사용과 같은 규칙, 4.2-1)
export type CardRow = Omit<AssetRow, "balance"> & { monthUsage: number };

export type AssetOverview = {
  assets: AssetRow[];
  liabilities: AssetRow[];
  cards: CardRow[];
  // 부채 합계는 부호를 뒤집은 양수다. 순자산 = 자산 합계 − 부채 합계.
  totals: { asset: number; liability: number; net: number };
};

// 카드 계정마다 그 달 사용액(결제 − 환불). 삭제 표시 안 된 일반 거래만 센다(getMonthlyReport의 카드 부분과 같다).
export async function getCardUsageByAccount(db: DbOrTx, userId: number, month: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ accountId: transactions.accountId, amount: sql<number>`sum(${transactions.amount})`.mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.kind, "normal"),
        eq(accounts.kind, "card"),
        monthRange(month),
      ),
    )
    .groupBy(transactions.accountId);
  return new Map(rows.map((r) => [r.accountId, 0 - r.amount]));
}

// 계정 순서는 listAccounts(종류 묶음 안 sort_order 순), 잔액은 getBalances를 그대로 쓴다(5.1).
// month: 카드 사용액을 셀 달(기본 이번 달).
export async function getAssetOverview(db: DbOrTx, userId: number, month: string = currentMonth()): Promise<AssetOverview> {
  const cardUsage = await getCardUsageByAccount(db, userId, month);
  const periodEnds = new Map(
    (
      await db
        .select({ accountId: imports.accountId, end: max(imports.periodEnd) })
        .from(imports)
        .where(eq(imports.userId, userId))
        .groupBy(imports.accountId)
    ).map((r) => [r.accountId, r.end]),
  );
  const list = (await listAccounts(db, userId)).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    institution: a.institution,
    balance: a.kind === "card" ? 0 : toDisplayBalance(a.kind, a.balance ?? 0),
    lastPeriodEnd: periodEnds.get(a.id) ?? null,
  }));
  const pick = (kind: "asset" | "liability"): AssetRow[] =>
    list.filter((a) => a.kind === kind).map(({ id, name, institution, balance, lastPeriodEnd }) => ({ id, name, institution, balance, lastPeriodEnd }));
  const assets = pick("asset");
  const liabilities = pick("liability");
  const cards = list
    .filter((a) => a.kind === "card")
    .map(({ id, name, institution, lastPeriodEnd }) => ({ id, name, institution, lastPeriodEnd, monthUsage: cardUsage.get(id) ?? 0 }));
  const asset = assets.reduce((s, a) => s + a.balance, 0);
  const liability = liabilities.reduce((s, a) => s + a.balance, 0);
  return { assets, liabilities, cards, totals: { asset, liability, net: asset - liability } };
}
