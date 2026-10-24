import { Suspense } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CreditCard, Wallet } from "lucide-react";
import { requireUser } from "@/auth/current";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { CategoryBadge } from "@/components/category-style";
import { Donut, TrendChart } from "@/components/charts";
import { DashboardSkeleton } from "@/components/loading";
import { MonthPicker } from "@/components/month-picker";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Columns, Panel, Stack, StatCard, StatRow } from "@/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { categoryColorValues } from "@/lib/category-style";
import { currentMonth, formatNumber } from "@/lib/format";
import { getMonthlyReport, getMonthlyTrend, leftoverRatio, type MoveLine, type ReportLine } from "@/lib/reports";
import type { AccountGroup } from "@/lib/transaction-filter";
import { parseMonth } from "@/lib/transaction-filter";

// 월별 수입/지출(6단계 파일 3장, design-refresh 명세서 4.3). 요약 카드 → 최근 6개월 → 지출·카드 사용 구성 → 수입·이동 순으로 쌓는다.
export default function Page({ searchParams }: PageProps<"/monthly">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="월별 수입/지출" />
          <DashboardSkeleton stats={4} panels={2} />
        </>
      }
    >
      <MonthlyView searchParams={searchParams} />
    </Suspense>
  );
}

// 카테고리를 누르면 그 달·그 부분의 거래 목록으로 간다(3.2). 미분류는 category=none이다.
function transactionsHref(kind: AccountGroup, month: string, categoryId?: number | null) {
  const category = categoryId === undefined ? "" : `&category=${categoryId ?? "none"}`;
  return `/transactions?kind=${kind}&month=${month}${category}`;
}

// "2026-10" → "10월"(막대 아래 이름). 1월은 연도를 붙여 해가 바뀐 것을 알 수 있게 한다.
function shortMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${String(y).slice(2)}년 1월` : `${m}월`;
}

const donutItems = (lines: ReportLine[]) =>
  lines.map((l) => ({ name: l.name, color: categoryColorValues(l.color).base, amount: l.amount }));

async function MonthlyView({ searchParams }: { searchParams: PageProps<"/monthly">["searchParams"] }) {
  const user = await requireUser();
  const thisMonth = currentMonth();
  // 전체 기간은 고를 수 없다. month=all로 들어오면 이번 달로 본다.
  const parsed = parseMonth((await searchParams).month, thisMonth);
  const month = parsed === "all" ? thisMonth : parsed;
  const db = getAppDb();
  const [{ account, card }, trend] = await Promise.all([getMonthlyReport(db, user.id, month), getMonthlyTrend(db, user.id, month)]);

  const hasAccount =
    account.incomeByCategory.length + account.expenseByCategory.length + account.moves.length > 0 || account.adjustments.count > 0;
  const hasCard = card.payments + card.refunds > 0;
  const left = account.income - account.expense;
  const ratio = leftoverRatio(account.income, account.expense);
  const accountPrefix = `${transactionsHref("account", month)}&category=`;
  const cardPrefix = `${transactionsHref("card", month)}&category=`;

  return (
    <>
      <PageHeader title="월별 수입/지출" actions={<MonthPicker value={month} allowAll={false} />} />
      <Stack>
        <StatRow>
          <StatCard
            label="수입"
            icon={<ArrowDownLeft className="size-3.5" />}
            value={<Money value={account.income} className="text-income" />}
            sub="계정 기준"
          />
          <StatCard
            label="지출"
            icon={<ArrowUpRight className="size-3.5" />}
            value={<Money value={account.expense} className="text-expense" />}
            sub="계정 기준 · 이동 제외"
          />
          <StatCard
            hero
            label="남은 돈"
            icon={<Wallet className="size-3.5" />}
            value={<Money value={left} signed plus />}
            sub={ratio != null ? `수입의 ${ratio}%` : left < 0 ? "지출이 수입보다 많습니다" : undefined}
          />
          <StatCard
            label="카드 사용"
            icon={<CreditCard className="size-3.5" />}
            value={<Money value={card.total} />}
            sub={`결제 ${formatNumber(card.payments)} · 환불 ${formatNumber(card.refunds)}`}
          />
        </StatRow>

        <Panel title="최근 6개월" aside="막대를 누르면 그 달로 이동합니다">
          <TrendChart
            months={trend.map((t) => ({ ...t, label: shortMonth(t.month) }))}
            current={month}
            hrefPrefix="/monthly?month="
          />
        </Panel>

        {!hasAccount && !hasCard ? (
          <Panel>
            <p className="text-muted-foreground">이 달에는 거래가 없습니다.</p>
          </Panel>
        ) : (
          <>
            <Columns>
              <Panel title="계정 지출" aside={<Money value={account.expense} />}>
                <Breakdown label="계정 지출" lines={account.expenseByCategory} hrefPrefix={accountPrefix} />
              </Panel>
              <Panel title="카드 사용" aside={<Money value={card.total} />}>
                <Breakdown label="카드 사용" lines={card.byCategory} hrefPrefix={cardPrefix} />
              </Panel>
            </Columns>
            <Columns>
              <Panel title="수입" aside={<Money value={account.income} />}>
                <CategoryBreakdown lines={account.incomeByCategory} hrefPrefix={accountPrefix} />
              </Panel>
              <Panel title="이동" aside="수입·지출에 넣지 않습니다">
                <MoveTable moves={account.moves} href={(id) => transactionsHref("account", month, id)} />
                {account.adjustments.count > 0 && (
                  <p className="mt-3 text-muted-foreground">
                    <Link href={transactionsHref("account", month)} className="hover:underline">
                      잔액 보정 {formatNumber(account.adjustments.count)}건
                    </Link>
                    , 합계 <Money value={account.adjustments.total} plus className="text-foreground" />
                    <span className="ml-2 text-xs">수입·지출에 넣지 않았습니다.</span>
                  </p>
                )}
              </Panel>
            </Columns>
          </>
        )}
      </Stack>
    </>
  );
}

// 도넛과 카테고리 목록. 좁은 폭에서는 도넛이 위로 간다.
function Breakdown({ label, lines, hrefPrefix }: { label: string; lines: ReportLine[]; hrefPrefix: string }) {
  if (lines.length === 0) return <p className="py-1 text-muted-foreground">거래가 없습니다.</p>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <Donut items={donutItems(lines)} label={label} />
      <CategoryBreakdown lines={lines} hrefPrefix={hrefPrefix} />
    </div>
  );
}

// 이동 표(1.4, 결정 G3). 수입·지출에 넣지 않은 카드대금·내 계좌 이동·개인 송금이다.
function MoveTable({ moves, href }: { moves: MoveLine[]; href: (categoryId: number) => string }) {
  if (moves.length === 0) return <p className="py-1 text-muted-foreground">이동이 없습니다.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이동</TableHead>
          <TableHead className="text-right">들어옴</TableHead>
          <TableHead className="text-right">나감</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {moves.map((m) => (
          <TableRow key={m.categoryId}>
            <TableCell>
              <Link href={href(m.categoryId)} className="hover:opacity-80">
                <CategoryBadge name={m.name} color={m.color} />
              </Link>
            </TableCell>
            <TableCell className="text-right">{m.inflow > 0 && <Money value={m.inflow} />}</TableCell>
            <TableCell className="text-right">{m.outflow > 0 && <Money value={m.outflow} />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
