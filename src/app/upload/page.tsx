import path from "node:path";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { PendingNotice } from "@/components/pending-notice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APP_DB_PATH, getAppDb } from "@/db/client";
import { formatDateTime, formatNumber } from "@/lib/format";
import { BACKUP_KEEP, backupDirFor } from "@/lib/import/backup";
import { listRecentImports } from "@/lib/import/upload";
import { UploadPanel } from "./upload-panel";

// 파일 업로드(3단계 파일 7장)
export default function Page() {
  return (
    <>
      <PageHeader title="파일 업로드" />
      <Suspense>
        <PendingNotice />
      </Suspense>
      <div className="flex flex-col gap-6">
        <UploadPanel />
        <Suspense>
          <RecentImports />
        </Suspense>
        <Suspense>
          <BackupNote />
        </Suspense>
      </div>
    </>
  );
}

async function RecentImports() {
  // better-sqlite3는 동기라 빌드 때 미리 그려지므로 요청마다 읽게 한다(design.md 2.3).
  await connection();
  const rows = listRecentImports(getAppDb());
  return (
    <section>
      <h2 className="mb-1 font-semibold text-muted-foreground">최근 업로드 기록</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">올린 시각</TableHead>
            <TableHead>파일</TableHead>
            <TableHead>계정</TableHead>
            <TableHead>기간</TableHead>
            <TableHead className="text-right">넣은 수</TableHead>
            <TableHead className="text-right">지운 수</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

// 백업 위치와 복원 방법(3단계 파일 6장). DB 경로가 실행할 때의 WONBOOK_DB_PATH로 정해지므로, 빌드 때 미리 그리지 않고 요청마다 그린다.
async function BackupNote() {
  await connection();
  const relative = (p: string) => path.relative(process.cwd(), p);
  return (
    <p className="text-xs text-muted-foreground">
      덮어쓰기 직전 백업은 <code>{relative(backupDirFor(APP_DB_PATH))}/</code>에 최근 {BACKUP_KEEP}개를 남깁니다. 되돌리려면 앱을 끄고 백업 파일을{" "}
      <code>{relative(APP_DB_PATH)}</code> 자리에 복사하세요.
    </p>
  );
}
