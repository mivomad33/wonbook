import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/auth/current";
import { TablesSkeleton } from "@/components/loading";
import { MonthPicker } from "@/components/month-picker";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { currentMonth, formatNumber } from "@/lib/format";
import { getMonthlyReport, type MoveLine, type ReportLine } from "@/lib/reports";
import type { AccountGroup } from "@/lib/transaction-filter";
import { parseMonth } from "@/lib/transaction-filter";
import { cn } from "@/lib/utils";

// 월별 수입/지출(6단계 파일 3장, 결정 G5). 계정 부분과 카드 부분을 한 화면에 쌓는다.
export default function Page({ searchParams }: PageProps<"/monthly">) {
  return (
    <>
      <PageHeader title="월별 수입/지출" />
      <Suspense fallback={<TablesSkeleton tables={2} />}>
        <MonthlyView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

// 카테고리를 누르면 그 달·그 부분의 거래 목록으로 간다(3.2). 미분류는 category=none이다.
function transactionsHref(kind: AccountGroup, month: string, categoryId?: number | null) {
  const category = categoryId === undefined ? "" : `&category=${categoryId ?? "none"}`;
  return `/transactions?kind=${kind}&month=${month}${category}`;
}

async function MonthlyView({ searchParams }: { searchParams: PageProps<"/monthly">["searchParams"] }) {
  const user = await requireUser();
  const thisMonth = currentMonth();
  // 전체 기간은 고를 수 없다. month=all로 들어오면 이번 달로 본다.
  const parsed = parseMonth((await searchParams).month, thisMonth);
  const month = parsed === "all" ? thisMonth : parsed;
  const { account, card } = await getMonthlyReport(getAppDb(), user.id, month);

  const hasAccount =
    account.incomeByCategory.length + account.expenseByCategory.length + account.moves.length > 0 || account.adjustments.count > 0;
  const hasCard = card.payments + card.refunds > 0;

  return (
    <>
      <div className="mb-4">
        <MonthPicker value={month} allowAll={false} />
      </div>

      {!hasAccount && !hasCard ? (
        <p className="text-muted-foreground">이 달 거래가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <SectionTitle>계정 수입/지출</SectionTitle>
            {!hasAccount ? (
              <p className="text-muted-foreground">거래가 없습니다.</p>
            ) : (
              <>
                <p className="mb-3 flex flex-wrap gap-x-4 text-muted-foreground">
                  <span>
                    수입 <Money value={account.income} className="text-foreground" />
                  </span>
                  <span>
                    지출 <Money value={account.expense} className="text-foreground" />
                  </span>
                  <span>
                    남은 돈 <Money value={account.income - account.expense} signed plus className="font-medium" />
                  </span>
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  <BreakdownTable title="수입" lines={account.incomeByCategory} href={(id) => transactionsHref("account", month, id)} />
                  <BreakdownTable title="지출" lines={account.expenseByCategory} href={(id) => transactionsHref("account", month, id)} />
                </div>
                {account.moves.length > 0 && (
                  <MoveTable moves={account.moves} href={(id) => transactionsHref("account", month, id)} />
                )}
                {account.adjustments.count > 0 && (
                  <p className="mt-3 text-muted-foreground">
                    <Link href={transactionsHref("account", month)} className="hover:underline">
                      잔액 보정 {formatNumber(account.adjustments.count)}건
                    </Link>
                    , 합계 <Money value={account.adjustments.total} plus className="text-foreground" />
                    <span className="ml-2 text-xs">수입·지출에 넣지 않았습니다.</span>
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <SectionTitle>카드 사용 내역</SectionTitle>
            {!hasCard ? (
              <p className="text-muted-foreground">거래가 없습니다.</p>
            ) : (
              <>
                <p className="mb-3 flex flex-wrap gap-x-4 text-muted-foreground">
                  <span>
                    사용 <Money value={card.total} className="font-medium text-foreground" />
                  </span>
                  <span className="text-xs">
                    결제 <Money value={card.payments} /> · 환불 <Money value={card.refunds} />
                  </span>
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  <BreakdownTable title="카테고리" lines={card.byCategory} href={(id) => transactionsHref("card", month, id)} />
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-2 font-semibold">{children}</h2>;
}

// 카테고리별 구성 표(카테고리, 금액, 비율). 음수 금액은 빨간 −로 보이고 비율은 비어 있다(1.5).
function BreakdownTable({ title, lines, href }: { title: string; lines: ReportLine[]; href: (categoryId: number | null) => string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{title}</TableHead>
          <TableHead className="text-right">금액</TableHead>
          <TableHead className="w-36">비율</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.length === 0 && (
          <TableRow>
            <TableCell colSpan={3} className="text-muted-foreground">
              없습니다.
            </TableCell>
          </TableRow>
        )}
        {lines.map((l) => (
          <TableRow key={l.categoryId ?? "none"}>
            <TableCell>
              <Link href={href(l.categoryId)} className={cn("hover:underline", l.categoryId == null && "text-muted-foreground")}>
                {l.name}
              </Link>
            </TableCell>
            <TableCell className="text-right">
              <Money value={l.amount} className={cn(l.amount < 0 && "text-red-600")} />
            </TableCell>
            <TableCell>{l.ratio != null && <RatioBar ratio={l.ratio} />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// 비율 숫자와 그 폭만큼의 옅은 막대(3.1)
function RatioBar({ ratio }: { ratio: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-right tabular-nums">{ratio}%</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/30" style={{ width: `${Math.min(ratio, 100)}%` }} />
      </div>
    </div>
  );
}

// 이동 표(1.4, 결정 G3). 수입·지출에 넣지 않은 카드대금·내 계좌 이동·개인 송금이다.
function MoveTable({ moves, href }: { moves: MoveLine[]; href: (categoryId: number) => string }) {
  return (
    <div className="mt-4 lg:w-1/2 lg:pr-2">
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
                <Link href={href(m.categoryId)} className="hover:underline">
                  {m.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">{m.inflow > 0 && <Money value={m.inflow} />}</TableCell>
              <TableCell className="text-right">{m.outflow > 0 && <Money value={m.outflow} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-1 text-xs text-muted-foreground">이동은 수입·지출에 넣지 않았습니다.</p>
    </div>
  );
}
