import { Suspense } from "react";
import { requireUser } from "@/auth/current";
import type { AccountOption } from "@/components/account-select";
import { TablesSkeleton } from "@/components/loading";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PendingNotice } from "@/components/pending-notice";
import { TransactionTags } from "@/components/transaction-tags";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { listAccounts } from "@/lib/accounts";
import { getBalance } from "@/lib/balance";
import { listCategoryOptions } from "@/lib/categories";
import { currentMonth, formatNumber, toDisplayBalance, today } from "@/lib/format";
import { parseTransactionFilter } from "@/lib/transaction-filter";
import { listTransactions, summarizeTransactions } from "@/lib/transactions";
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
      <Suspense fallback={<TablesSkeleton rows={8} />}>
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

  return (
    <TransactionEditor accounts={accounts} categories={categories} defaults={defaults}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TransactionFilters accounts={accounts} categories={categories} filter={filter} />
        <div className="ml-auto flex gap-2">
          <NewTransactionButtons />
        </div>
      </div>

      <p className="mb-2 flex flex-wrap gap-x-4 text-muted-foreground">
        <span>{formatNumber(summary.count)}건</span>
        <span>
          수입 <Money value={summary.income} className="text-foreground" />
        </span>
        <span>
          지출 <Money value={summary.expense} className="text-foreground" />
        </span>
        {account && balance !== undefined && (
          <span>
            현재 잔액 <Money value={toDisplayBalance(account.kind, balance)} className="font-medium text-foreground" />
          </span>
        )}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">날짜</TableHead>
            {/* 휴대폰 폭에서는 덜 중요한 칸(시각, 방식)을 감춘다(4.6-3). 나머지는 표 안에서 가로로 민다. */}
            <TableHead className="hidden w-20 sm:table-cell">시각</TableHead>
            {showAccount && <TableHead>계정</TableHead>}
            <TableHead>내용</TableHead>
            <TableHead className="hidden sm:table-cell">방식</TableHead>
            <TableHead>메모</TableHead>
            <TableHead>카테고리</TableHead>
            <TableHead className="text-right">금액</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showAccount ? 9 : 8} className="text-muted-foreground">
                거래가 없습니다.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id} className={cn(r.deletedAt && "text-muted-foreground opacity-60")}>
              <TableCell className="tabular-nums">{r.date}</TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">{r.time}</TableCell>
              {showAccount && <TableCell>{r.accountName}</TableCell>}
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{r.description}</span>
                  <TransactionTags row={r} />
                </div>
                {r.accountKind === "card" && r.cardLabel && <div className="text-xs text-muted-foreground">{r.cardLabel}</div>}
              </TableCell>
              <TableCell className="hidden sm:table-cell">{r.method}</TableCell>
              <TableCell>{r.memo}</TableCell>
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
        </TableBody>
      </Table>
    </TransactionEditor>
  );
}
