"use client";

import { useEffect, useState, useTransition } from "react";
import { CategoryBadge, type CategoryOption } from "@/components/category-select";
import { useDemoGuard } from "@/components/demo-guard";
import { formatNumber } from "@/lib/format";
import type { TransactionListItem } from "@/lib/transactions";
import { setTransactionCategoryAction } from "./actions";

// 거래 목록의 카테고리 칸(5단계 파일 7.1). 이체·보정 거래는 비우고, 삭제 표시한 거래는 보여주기만 한다.
export function CategoryCell({ row, categories }: { row: TransactionListItem; categories: CategoryOption[] }) {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { guard } = useDemoGuard();
  // 결과 문구는 잠깐 보여주고 지운다.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(undefined), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  if (row.kind !== "normal") return null;
  const change = guard((categoryId: number) =>
    startTransition(async () => {
      const r = await setTransactionCategoryAction(row.id, categoryId);
      if ("error" in r) setMessage(r.error);
      else setMessage(r.sameKeyCount > 0 ? `같은 가맹점 ${formatNumber(r.sameKeyCount)}건도 바꿨습니다` : undefined);
    }),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <CategoryBadge
        categories={categories}
        categoryId={row.categoryId}
        name={row.categoryName}
        disabled={pending}
        onChange={row.deletedAt ? undefined : change}
      />
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
