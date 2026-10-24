import { Fragment, Suspense } from "react";
import { requireUser } from "@/auth/current";
import type { AccountOption } from "@/components/account-select";
import { DashboardSkeleton } from "@/components/loading";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard, StatRow } from "@/components/panel";
import { PendingNotice } from "@/components/pending-notice";
import { TransactionTags } from "@/components/transaction-tags";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { listAccounts } from "@/lib/accounts";
import { getBalance } from "@/lib/balance";
import { listCategoryOptions } from "@/lib/categories";
import { currentMonth, formatDayHeader, formatNumber, toDisplayBalance, today } from "@/lib/format";
import { parseTransactionFilter } from "@/lib/transaction-filter";
import { groupByDate, listTransactions, summarizeTransactions } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { CategoryCell } from "./category-cell";
import { TransactionEditor } from "./transaction-editor";
import { TransactionFilters } from "./transaction-filters";
import { NewTransactionButtons, TransactionRowActions } from "./transaction-row-actions";

// 거래 목록(2단계 파일 2장)
export default function Page({ searchParams }: PageProps<"/transactions">) {
  return (
    <>
      <PageHeader title="거래 목록" />
      <Suspense>
        <PendingNotice />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton stats={3} rows={8} />}>
        <TransactionsView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TransactionsView({ searchParams }: { searchParams: PageProps<"/transactions">["searchParams"] }) {
  const user = await requireUser();
  const db = getAppDb();
  const thisMonth = currentMonth();
  const [accountList, categories, params] = await Promise.all([listAccounts(db, user.id), listCategoryOptions(db, user.id), searchParams]);
  const accounts: AccountOption[] = accountList.map(({ id, name, kind }) => ({ id, name, kind }));
  const parsed = parseTransactionFilter(params, thisMonth);
  const account = accounts.find((a) => a.id === parsed.accountId);
  // 없는 계정·카테고리면 그 조건을 뺀다.
  const categoryId = parsed.categoryId === "none" || categories.some((c) => c.id === parsed.categoryId) ? parsed.categoryId : null;
  const filter = { ...parsed, accountId: account?.id ?? null, categoryId };

  const [rows, balance] = await Promise.all([
    listTransactions(db, user.id, filter),
    // 계정 하나로 거르면 오늘까지 전체 기준 잔액을 보여준다. 카드 계정은 잔액이 없다(2단계 파일 2.2).
    account && account.kind !== "card" ? getBalance(db, user.id, account.id) : undefined,
  ]);
  const summary = summarizeTransactions(rows);
  const defaults = {
    accountId: filter.accountId,
    date: filter.month !== "all" && filter.month !== thisMonth ? `${filter.month}-01` : today(),
  };
  const showAccount = filter.accountId == null;
  const columns = showAccount ? 8 : 7;

  return (
    <TransactionEditor accounts={accounts} categories={categories} defaults={defaults}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TransactionFilters accounts={accounts} categories={categories} filter={filter} />
        <div className="ml-auto flex gap-2">
          <NewTransactionButtons />
        </div>
      </div>

      <div className="mb-3.5">
        <StatRow>
          <StatCard label="거래" value={`${formatNumber(summary.count)}건`} />
          <StatCard label="수입" value={<Money value={summary.income} className="text-income" />} />
          <StatCard label="지출" value={<Money value={summary.expense} className="text-expense" />} />
          {account && balance !== undefined && (
            <StatCard label="현재 잔액" value={<Money value={toDisplayBalance(account.kind, balance)} />} sub={account.name} />
          )}
        </StatRow>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {/* 좁은 폭에서는 덜 중요한 칸(시각, 방식, 메모)을 감추고 내용 아래 보조 줄에 보여 준다(4.6-3, design-refresh 4.4-4). */}
            <TableHead className="hidden w-16 lg:table-cell">시각</TableHead>
            {showAccount && <TableHead>계정</TableHead>}
            <TableHead>내용</TableHead>
            <TableHead className="hidden lg:table-cell">방식</TableHead>
            <TableHead className="hidden lg:table-cell">메모</TableHead>
            <TableHead>카테고리</TableHead>
            <TableHead className="text-right">금액</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns} className="text-muted-foreground">
                거래가 없습니다.
              </TableCell>
            </TableRow>
          )}
          {groupByDate(rows).map(([date, dayRows]) => (
            <Fragment key={date}>
              {/* 날짜 머리줄(4.4-2). 날짜 칸 대신 그날 거래를 묶는다. */}
              <TableRow className="bg-subtle hover:bg-subtle" data-day-header={date}>
                <TableCell colSpan={columns} className="py-1.5 text-xs font-semibold text-muted-foreground">
                  <time dateTime={date}>{formatDayHeader(date)}</time>
                </TableCell>
              </TableRow>
              {dayRows.map((r) => (
                <TableRow key={r.id} className={cn(r.deletedAt && "text-muted-foreground opacity-60")} data-transaction-row="">
                  <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">{r.time}</TableCell>
                  {showAccount && <TableCell>{r.accountName}</TableCell>}
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{r.description}</span>
                      <TransactionTags row={r} />
                    </div>
                    {r.accountKind === "card" && r.cardLabel && <div className="text-xs text-muted-foreground">{r.cardLabel}</div>}
                    <div className="text-xs text-muted-foreground lg:hidden">{[r.time, r.method, r.memo].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.method}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.memo}</TableCell>
                  <TableCell>
                    <CategoryCell row={r} categories={categories} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={r.amount} signed={!r.deletedAt} />
                  </TableCell>
                  <TableCell>
                    <TransactionRowActions row={r} />
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TransactionEditor>
  );
}
