import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/auth/current";
import { countUsers } from "@/auth/users";
import { PageHeader } from "@/components/page-header";
import { Panel, Stack, StatCard, StatRow } from "@/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { classifyLimits, todayUsage } from "@/lib/categorize/quota";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "관리자" };

// 관리자 화면(4.6-5): 가입자 수와 오늘 분류 사용량만 보여 준다. 다른 사용자의 계정·거래·금액은 보여 주지 않는다.
export default function Page() {
  return (
    <>
      <PageHeader title="관리자" />
      <Suspense>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  await requireAdmin();
  const db = getAppDb();
  const [users, usage] = await Promise.all([countUsers(db), todayUsage(db)]);
  const { userDaily } = classifyLimits();
  return (
    <Stack className="max-w-xl">
      <StatRow>
        <StatCard label="가입자" value={`${formatNumber(users)}명`} />
        <StatCard label="오늘 분류(전체)" value={`${formatNumber(usage.total)} / ${formatNumber(usage.totalLimit)}키`} />
      </StatRow>
      <Panel title="오늘 분류 사용량" aside={`사용자별, 한도 ${formatNumber(userDaily)}키`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>사용자</TableHead>
              <TableHead className="text-right">키 수</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.perUser.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground">
                  오늘 분류한 사용자가 없습니다.
                </TableCell>
              </TableRow>
            )}
            {usage.perUser.map((u) => (
              <TableRow key={u.userId}>
                <TableCell className="tabular-nums">#{u.userId}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(u.count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">관리자의 분류는 한도와 전체 횟수에 넣지 않습니다.</p>
      </Panel>
    </Stack>
  );
}
