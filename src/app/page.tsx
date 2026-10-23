import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { listAdjustmentNotice } from "@/lib/balance/notice";
import { daysBetween, today } from "@/lib/format";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { type AssetRow, getAssetOverview } from "@/lib/reports";
import { dismissAdjustmentNoticeAction } from "./actions";

// 자산 현황(6단계 파일 4장, 결정 G6)
export default function Page() {
  return (
    <>
      <PageHeader title="자산 현황" />
      <Suspense>
        <AdjustmentNotice />
      </Suspense>
      <Suspense>
        <Overview />
      </Suspense>
    </>
  );
}

// 새로 생긴 잔액 보정 거래 알림(4단계 파일 6.2·6.3). "닫기"를 누를 때까지 보인다.
async function AdjustmentNotice() {
  await connection();
  const items = listAdjustmentNotice(getAppDb());
  if (items.length === 0) return null;
  return (
    <Notice
      title="잔액 보정 거래가 생겼습니다"
      action={
        <form action={dismissAdjustmentNoticeAction}>
          <Button type="submit" variant="ghost" size="xs">
            닫기
          </Button>
        </form>
      }
    >
      <ul>
        {items.map((item) => (
          <li key={item.accountId}>
            <Link href={`/transactions?account=${item.accountId}&month=${item.lastMonth}`} className="hover:underline">
              {item.accountName}
            </Link>
            <span className="text-amber-900/80">
              {" "}
              {item.count}건, 합계 <Money value={item.total} plus />
            </span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

async function Overview() {
  await connection();
  const { assets, liabilities, cards, totals } = getAssetOverview(getAppDb());
  if (assets.length + liabilities.length + cards.length === 0) {
    return (
      <p className="text-muted-foreground">
        계정이 없습니다. <Link href="/accounts" className="underline">계정 관리</Link>에서 만드세요.
      </p>
    );
  }
  const now = today();

  return (
    <>
      <p className="mb-3 flex flex-wrap items-baseline gap-x-4 text-muted-foreground">
        <span>
          자산 합계 <Money value={totals.asset} className="text-foreground" />
        </span>
        <span>
          부채 합계 <Money value={totals.liability} className="text-foreground" />
        </span>
        <span>
          순자산 <Money value={totals.net} className="text-lg font-semibold text-foreground" />
        </span>
      </p>

      {assets.length + liabilities.length > 0 && (
        <Table className="w-auto min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>계정</TableHead>
              <TableHead>금융사</TableHead>
              <TableHead className="text-right">잔액</TableHead>
              <TableHead>올린 기간</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AccountGroupRows label="자산" rows={assets} subtotal={totals.asset} now={now} />
            <AccountGroupRows label="부채" rows={liabilities} subtotal={totals.liability} now={now} />
          </TableBody>
        </Table>
      )}

      {cards.length > 0 && (
        <Table className="mt-6 w-auto min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>카드</TableHead>
              <TableHead>금융사</TableHead>
              <TableHead>올린 기간</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <AccountLink id={c.id} name={c.name} />
                </TableCell>
                <TableCell className="text-muted-foreground">{institutionLabel(c.institution)}</TableCell>
                <TableCell>
                  <PeriodEnd end={c.lastPeriodEnd} now={now} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

const institutionLabel = (institution: AssetRow["institution"]) => (institution ? INSTITUTION_LABELS[institution] : "수동");

function AccountLink({ id, name }: { id: number; name: string }) {
  return (
    <Link href={`/transactions?account=${id}`} className="hover:underline">
      {name}
    </Link>
  );
}

// 묶음 이름 줄, 계정 줄, 소계 줄. 계정이 없는 묶음은 보이지 않는다.
function AccountGroupRows({ label, rows, subtotal, now }: { label: string; rows: AssetRow[]; subtotal: number; now: string }) {
  if (rows.length === 0) return null;
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={4} className="pt-3 font-medium text-muted-foreground">
          {label}
        </TableCell>
      </TableRow>
      {rows.map((a) => (
        <TableRow key={a.id}>
          <TableCell className="pl-4">
            <AccountLink id={a.id} name={a.name} />
          </TableCell>
          <TableCell className="text-muted-foreground">{institutionLabel(a.institution)}</TableCell>
          <TableCell className="text-right">
            <Money value={a.balance} />
          </TableCell>
          <TableCell>
            <PeriodEnd end={a.lastPeriodEnd} now={now} />
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={2} className="pl-4 text-muted-foreground">
          {label} 소계
        </TableCell>
        <TableCell className="text-right font-medium">
          <Money value={subtotal} />
        </TableCell>
        <TableCell />
      </TableRow>
    </>
  );
}

// 가장 늦게 올린 끝 날짜와 오늘까지 며칠인지(4.1). 업로드가 없거나 수동 계정이면 비운다.
function PeriodEnd({ end, now }: { end: string | null; now: string }) {
  if (!end) return null;
  const days = daysBetween(end, now);
  return (
    <span className="tabular-nums">
      ~ {end} <span className="text-muted-foreground">({days <= 0 ? "오늘" : `${days}일 전`})</span>
    </span>
  );
}
