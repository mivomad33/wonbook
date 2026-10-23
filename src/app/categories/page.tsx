import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { CATEGORY_GROUPS, type CategoryGroup } from "@/db/schema";
import { listCategories, type CategoryListItem } from "@/lib/categories";
import { countOtherAiRules } from "@/lib/categorize";
import { formatNumber } from "@/lib/format";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { CategoryFormDialog } from "./category-form-dialog";
import { CategoryRowActions } from "./category-row-actions";
import { ReclassifyOthersButton } from "./reclassify-others";

// 카테고리(5단계 파일 8장). 목록과 추가·이름 바꾸기·삭제만 둔다.
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
      <Suspense>
        <CategoryGroups />
      </Suspense>
    </>
  );
}

async function HeaderActions() {
  // better-sqlite3는 동기라 빌드 때 미리 그려지므로 요청마다 읽게 한다(design.md 2.3).
  await connection();
  const othersCount = countOtherAiRules(getAppDb());
  return (
    <>
      {othersCount > 0 && <ReclassifyOthersButton count={othersCount} trigger={<Button variant="outline">기타 다시 분류</Button>} />}
      <CategoryFormDialog othersCount={othersCount} trigger={<Button>카테고리 추가</Button>} />
    </>
  );
}

async function CategoryGroups() {
  await connection();
  const list = listCategories(getAppDb());
  return (
    <div className="flex flex-col gap-6">
      {CATEGORY_GROUPS.map((group) => (
        <CategoryGroupTable key={group} group={group} categories={list.filter((c) => c.group === group)} />
      ))}
    </div>
  );
}

function CategoryGroupTable({ group, categories }: { group: CategoryGroup; categories: CategoryListItem[] }) {
  return (
    <section>
      <h2 className="mb-1 font-semibold text-muted-foreground">{CATEGORY_GROUP_LABELS[group]}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead className="w-24 text-right">거래 수</TableHead>
            <TableHead className="w-28 text-right">저장된 분류 수</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                {CATEGORY_GROUP_LABELS[group]} 카테고리가 없습니다.
              </TableCell>
            </TableRow>
          )}
          {categories.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {/* 거래 목록은 기본이 이번 달이라 전체 기간으로 건다. */}
                <Link href={`/transactions?category=${c.id}&month=all`} className="hover:underline">
                  {formatNumber(c.transactionCount)}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(c.ruleCount)}</TableCell>
              <TableCell>
                <CategoryRowActions category={c} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
