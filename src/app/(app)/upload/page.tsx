import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/auth/current";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { PendingNotice } from "@/components/pending-notice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { classifyLimits } from "@/lib/categorize/quota";
import { formatDateTime, formatNumber } from "@/lib/format";
import { listRecentImports } from "@/lib/import/upload";
import { SUPPORTED_TEXT } from "./read-files";
import { UndoButton } from "./undo-button";
import { UploadPanel } from "./upload-panel";

// 파일 업로드(3단계 파일 7장, 4.3)
export default function Page() {
  return (
    <>
      <PageHeader title="파일 업로드" />
      <Suspense>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const user = await requireUser();
  return (
    <>
      <PendingNotice userId={user.id} />
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">지원하는 금융사: {SUPPORTED_TEXT}. 다른 금융사 계좌는 계정 관리에서 수동 계정으로 만들어 직접 입력할 수 있습니다.</p>
        <UploadPanel isDemo={user.isDemo} userDailyLimit={classifyLimits().userDaily} />
        <RecentImports userId={user.id} isDemo={user.isDemo} />
      </div>
    </>
  );
}

async function RecentImports({ userId, isDemo }: { userId: number; isDemo: boolean }) {
  const rows = await listRecentImports(getAppDb(), userId);
  return (
    <Panel title="최근 업로드 기록">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">올린 시각</TableHead>
              <TableHead>파일</TableHead>
              <TableHead>계정</TableHead>
              <TableHead>기간</TableHead>
              <TableHead className="text-right">넣은 수</TableHead>
              <TableHead className="text-right">지운 수</TableHead>
              <TableHead>되돌리기</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  업로드 기록이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                <TableCell className="max-w-56 truncate">{r.fileName}</TableCell>
                <TableCell>
                  <Link href={`/transactions?account=${r.accountId}&month=${r.periodEnd.slice(0, 7)}`} className="hover:underline">
                    {r.accountName}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.periodStart} ~ {r.periodEnd}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(r.insertedCount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(r.deletedCount)}</TableCell>
                <TableCell>
                  {r.undoable ? <UndoButton importId={r.id} isDemo={isDemo} label={`${r.accountName} ${r.periodStart} ~ ${r.periodEnd}`} /> : <span className="text-xs text-muted-foreground">되돌릴 수 없음</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">계정마다 가장 최근 업로드 하나를 되돌릴 수 있습니다. 되돌리면 올리기 전 거래와 잔액으로 돌아갑니다.</p>
    </Panel>
  );
}
