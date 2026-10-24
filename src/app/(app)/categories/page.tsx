import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/auth/current";
import { CategoryIconBox } from "@/components/category-style";
import { DashboardSkeleton } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { Columns, Panel, Stack } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { getAppDb } from "@/db/client";
import { CATEGORY_GROUPS, type CategoryGroup } from "@/db/schema";
import { listCategories, type CategoryListItem } from "@/lib/categories";
import { countOtherAiRules } from "@/lib/categorize";
import { formatNumber } from "@/lib/format";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { CategoryFormDialog } from "./category-form-dialog";
import { CategoryRowActions } from "./category-row-actions";
import { ReclassifyOthersButton } from "./reclassify-others";

// 카테고리(5단계 파일 8장, design-refresh 명세서 4.5-6). 목록과 추가·고치기(이름·묶음·색·아이콘)·삭제만 둔다.
export default function Page() {
  return (
    <>
      <PageHeader
        title="카테고리"
        actions={
          <Suspense>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense fallback={<DashboardSkeleton stats={0} panels={2} />}>
        <CategoryGroups />
      </Suspense>
    </>
  );
}

async function HeaderActions() {
  const user = await requireUser();
  const othersCount = await countOtherAiRules(getAppDb(), user.id);
  return (
    <>
      {othersCount > 0 && <ReclassifyOthersButton count={othersCount} trigger={<Button variant="outline">기타 다시 분류</Button>} />}
      <CategoryFormDialog othersCount={othersCount} trigger={<Button>카테고리 추가</Button>} />
    </>
  );
}

async function CategoryGroups() {
  const user = await requireUser();
  const list = await listCategories(getAppDb(), user.id);
  return (
    <Columns>
      <CategoryGroupPanel group="expense" categories={list.filter((c) => c.group === "expense")} />
      <Stack>
        {CATEGORY_GROUPS.filter((g) => g !== "expense").map((group) => (
          <CategoryGroupPanel key={group} group={group} categories={list.filter((c) => c.group === group)} />
        ))}
      </Stack>
    </Columns>
  );
}

// 묶음별 목록(design-refresh 확정안의 카테고리 화면): 아이콘, 이름, 거래 수·저장된 분류 수, 고치기·삭제.
function CategoryGroupPanel({ group, categories }: { group: CategoryGroup; categories: CategoryListItem[] }) {
  return (
    <Panel title={CATEGORY_GROUP_LABELS[group]} aside={`${formatNumber(categories.length)}개`}>
      {categories.length === 0 ? (
        <p className="text-muted-foreground">{CATEGORY_GROUP_LABELS[group]} 카테고리가 없습니다.</p>
      ) : (
        <ul>
          {categories.map((c) => (
            <li key={c.id} data-category-row className="flex items-center gap-3 border-b py-2 last:border-b-0">
              <CategoryIconBox color={c.color} icon={c.icon} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {/* 거래 목록은 기본이 이번 달이라 전체 기간으로 건다. */}
                  <Link href={`/transactions?category=${c.id}&month=all`} className="hover:underline">
                    거래 {formatNumber(c.transactionCount)}건
                  </Link>
                  {" · "}저장된 분류 {formatNumber(c.ruleCount)}개
                </span>
              </div>
              <CategoryRowActions category={c} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
