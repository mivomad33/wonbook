"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { CategoryListItem } from "@/lib/categories";
import { isFixedCategory } from "@/lib/category-form";
import { formatNumber } from "@/lib/format";
import { deleteCategoryAction } from "./actions";
import { CategoryFormDialog } from "./category-form-dialog";

// 고치기·삭제 버튼(5단계 파일 8장, design-refresh 명세서 4.5-6).
// "기타" 카테고리는 AI 분류에 이름으로 쓰므로 지우지 않고, 고치기에서는 색·아이콘만 바꾼다(lib/categories.ts).
export function CategoryRowActions({ category }: { category: CategoryListItem }) {
  const edit = (
    <CategoryFormDialog
      category={category}
      trigger={
        <Button variant="ghost" size="icon-xs" aria-label={`${category.name} 고치기`} title="고치기">
          <PencilIcon />
        </Button>
      }
    />
  );
  if (isFixedCategory(category.name))
    return (
      <div className="flex items-center justify-end gap-1">
        <span className="text-xs text-muted-foreground">AI 분류에 씀</span>
        {edit}
      </div>
    );
  const used = category.transactionCount > 0 || category.ruleCount > 0;
  return (
    <div className="flex justify-end gap-1">
      {edit}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-xs" aria-label={`${category.name} 삭제`} title="삭제">
            <Trash2Icon />
          </Button>
        }
        title={`"${category.name}" 카테고리를 지울까요?`}
        description={
          used
            ? `거래 ${formatNumber(category.transactionCount)}건은 미분류가 되고, 저장된 분류 ${formatNumber(category.ruleCount)}개는 함께 지워집니다. 미분류가 된 업로드 거래는 "다시 분류"로 다시 분류할 수 있습니다.`
            : "이 카테고리에는 거래와 저장된 분류가 없습니다."
        }
        confirmLabel="삭제"
        destructive={used}
        onConfirm={() => deleteCategoryAction(category.id)}
      />
    </div>
  );
}
