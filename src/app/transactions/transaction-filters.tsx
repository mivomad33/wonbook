"use client";

import { AccountFilterSelect, type AccountOption } from "@/components/account-select";
import { CategoryFilterSelect, type CategoryOption } from "@/components/category-select";
import { MonthPicker } from "@/components/month-picker";
import { useQueryUpdate } from "@/hooks/use-query-update";
import type { TransactionFilter } from "@/lib/transaction-filter";

// 거르기 조건(2단계 파일 2.1, 카테고리는 5단계 파일 7.1). 바꾸면 URL 쿼리를 바꿔 이동한다.
export function TransactionFilters({
  accounts,
  categories,
  filter,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  filter: TransactionFilter;
}) {
  const updateQuery = useQueryUpdate();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AccountFilterSelect
        accounts={accounts}
        value={filter}
        onChange={({ accountId, group }) => updateQuery({ account: accountId == null ? null : String(accountId), kind: group })}
      />
      <MonthPicker value={filter.month} />
      <CategoryFilterSelect
        categories={categories}
        value={filter.categoryId}
        onChange={(categoryId) => updateQuery({ category: categoryId == null ? null : String(categoryId) })}
      />
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={filter.showDeleted}
          onChange={(e) => updateQuery({ deleted: e.target.checked ? "1" : null })}
        />
        삭제한 거래 보기
      </label>
    </div>
  );
}
