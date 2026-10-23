// 월별 수입/지출과 자산 현황 집계(6단계 파일 2·4·5장).
// SQL에서 계정 종류·카테고리·부호로 묶어 합을 구하고, 나누기·정렬·비율은 아래 순수 함수로 한다.
import { and, eq, gte, isNull, lt, max, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, categories, imports, type Institution, transactions } from "@/db/schema";
import { listAccounts } from "@/lib/accounts";
import { shiftMonth, toDisplayBalance } from "@/lib/format";

export const UNCATEGORIZED_NAME = "미분류";

// 구성 한 줄. categoryId null은 미분류다.
export type ReportLine = { categoryId: number | null; name: string; amount: number; ratio: number | null };
// 이동 표 한 줄. inflow는 양수 합, outflow는 음수 합의 부호를 뒤집은 값이다.
export type MoveLine = { categoryId: number; name: string; inflow: number; outflow: number };

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

// 카테고리별 금액을 구성 줄로 만든다. 같은 카테고리는 합치고, 0인 줄은 뺀다.
// 금액이 큰 순, 미분류는 맨 아래. 금액이 같으면 이름 순이다.
export function buildLines(entries: readonly { categoryId: number | null; name: string; amount: number }[]): ReportLine[] {
  const merged = new Map<number | null, { categoryId: number | null; name: string; amount: number }>();
  for (const e of entries) {
    const found = merged.get(e.categoryId);
    if (found) found.amount += e.amount;
    else merged.set(e.categoryId, { ...e, name: e.categoryId == null ? UNCATEGORIZED_NAME : e.name });
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

export function getMonthlyReport(db: Db, month: string): MonthlyReport {
  const isCard = sql<number>`${accounts.kind} = 'card'`;
  const positive = sql<number>`${transactions.amount} > 0`;
  // 삭제 표시 안 된 일반 거래를 (카드 여부, 카테고리, 부호)로 묶는다. 이체·보정은 넣지 않는다(1.1·1.2).
  const rows = db
    .select({
      isCard,
      positive,
      categoryId: transactions.categoryId,
      name: categories.name,
      group: categories.group,
      amount: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(isNull(transactions.deletedAt), eq(transactions.kind, "normal"), monthRange(month)))
    .groupBy(isCard, transactions.categoryId, positive)
    .all()
    .map((r) => ({ ...r, isCard: Boolean(r.isCard), positive: Boolean(r.positive), name: r.name ?? UNCATEGORIZED_NAME }));

  // 계정 부분: 이동 묶음은 이동 표로 빼고, 나머지를 부호로 수입·지출로 나눈다(1.4·1.5).
  const accountRows = rows.filter((r) => !r.isCard);
  const moveMap = new Map<number, MoveLine>();
  for (const r of accountRows) {
    if (r.group !== "move" || r.categoryId == null) continue;
    const line = moveMap.get(r.categoryId) ?? { categoryId: r.categoryId, name: r.name, inflow: 0, outflow: 0 };
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
  const adjustment = db
    .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.kind, "adjustment"),
        sql`${accounts.kind} <> 'card'`,
        monthRange(month),
      ),
    )
    .get() ?? { count: 0, total: 0 };

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

export type AssetRow = {
  id: number;
  name: string;
  institution: Institution | null;
  // 화면에 보일 값(부채는 부호를 뒤집은 값)
  balance: number;
  // 업로드 기록 중 가장 늦은 period_end. 업로드가 없으면 null(6단계 파일 4.1).
  lastPeriodEnd: string | null;
};
export type CardRow = Omit<AssetRow, "balance">;

export type AssetOverview = {
  assets: AssetRow[];
  liabilities: AssetRow[];
  cards: CardRow[];
  // 부채 합계는 부호를 뒤집은 양수다. 순자산 = 자산 합계 − 부채 합계.
  totals: { asset: number; liability: number; net: number };
};

// 계정 순서는 listAccounts(종류 묶음 안 sort_order 순), 잔액은 getBalances를 그대로 쓴다(5.1).
export function getAssetOverview(db: Db): AssetOverview {
  const periodEnds = new Map(
    db
      .select({ accountId: imports.accountId, end: max(imports.periodEnd) })
      .from(imports)
      .groupBy(imports.accountId)
      .all()
      .map((r) => [r.accountId, r.end]),
  );
  const list = listAccounts(db).map((a) => ({
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
  const cards = list.filter((a) => a.kind === "card").map(({ id, name, institution, lastPeriodEnd }) => ({ id, name, institution, lastPeriodEnd }));
  const asset = assets.reduce((s, a) => s + a.balance, 0);
  const liability = liabilities.reduce((s, a) => s + a.balance, 0);
  return { assets, liabilities, cards, totals: { asset, liability, net: asset - liability } };
}
