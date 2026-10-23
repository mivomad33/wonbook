import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAppDb } from "@/db/client";
import { ACCOUNT_KINDS, type AccountKind } from "@/db/schema";
import { listAccounts, type AccountListItem } from "@/lib/accounts";
import { formatNumber, toDisplayBalance } from "@/lib/format";
import { ACCOUNT_KIND_LABELS, INSTITUTION_LABELS } from "@/lib/labels";
import { AccountFormDialog } from "./account-form-dialog";
import { AccountRowActions, MoveButtons } from "./account-row-actions";

// 계정 관리(2단계 파일 1장)
export default function Page() {
  return (
    <>
      <PageHeader title="계정 관리" actions={<AccountFormDialog trigger={<Button>계정 추가</Button>} />} />
      <Suspense>
        <AccountGroups />
      </Suspense>
    </>
  );
}

async function AccountGroups() {
  // better-sqlite3는 동기라 빌드 때 미리 그려지므로 요청마다 읽게 한다(design.md 2.3).
  await connection();
  const list = listAccounts(getAppDb());
  return (
    <div className="flex flex-col gap-6">
      {ACCOUNT_KINDS.map((kind) => (
        <AccountGroup key={kind} kind={kind} accounts={list.filter((a) => a.kind === kind)} />
      ))}
    </div>
  );
}

function AccountGroup({ kind, accounts }: { kind: AccountKind; accounts: AccountListItem[] }) {
  // 카드 계정은 잔액을 쓰지 않아 기초 잔액·기준일을 뺀다(2단계 파일 1.1).
  const showOpening = kind !== "card";
  return (
    <section>
      <h2 className="mb-1 font-semibold text-muted-foreground">{ACCOUNT_KIND_LABELS[kind]}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">순서</TableHead>
            <TableHead>이름</TableHead>
            <TableHead>금융사</TableHead>
            <TableHead>계좌 식별값</TableHead>
            {showOpening && <TableHead className="text-right">기초 잔액</TableHead>}
            {showOpening && <TableHead>기준일</TableHead>}
            <TableHead className="text-right">거래 수</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.length === 0 && (
            <TableRow>
              <TableCell colSpan={showOpening ? 8 : 6} className="text-muted-foreground">
                {ACCOUNT_KIND_LABELS[kind]} 계정이 없습니다.
              </TableCell>
            </TableRow>
          )}
          {accounts.map((a, i) => (
            <TableRow key={a.id}>
              <TableCell>
                <MoveButtons id={a.id} isFirst={i === 0} isLast={i === accounts.length - 1} />
              </TableCell>
              <TableCell>
                <Link href={`/transactions?account=${a.id}&month=all`} className="hover:underline">
                  {a.name}
                </Link>
              </TableCell>
              <TableCell>{a.institution ? INSTITUTION_LABELS[a.institution] : "수동"}</TableCell>
              <TableCell className="tabular-nums">{a.externalKey}</TableCell>
              {showOpening && (
                <TableCell className="text-right">
                  <Money value={toDisplayBalance(a.kind, a.openingBalance)} />
                </TableCell>
              )}
              {showOpening && <TableCell className="tabular-nums">{a.openingDate}</TableCell>}
              <TableCell className="text-right tabular-nums">{formatNumber(a.transactionCount)}</TableCell>
              <TableCell>
                <AccountRowActions account={a} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
