import { type ReactNode, Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/auth/current";
import { AccountKindIcon } from "@/components/account-kind-icon";
import { ShareBar } from "@/components/charts";
import { DashboardSkeleton } from "@/components/loading";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Columns, Panel, Stack, StatCard, StatRow } from "@/components/panel";
import type { AccountKind } from "@/db/schema";
import { getAppDb } from "@/db/client";
import { listAdjustmentNotice } from "@/lib/balance/notice";
import { daysBetween, today } from "@/lib/format";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { shareItems } from "@/lib/asset-share";
import { type AssetRow, getAssetOverview } from "@/lib/reports";
import { DismissNoticeButton } from "./dismiss-notice-button";

// 자산 현황(6단계 파일 4장, 결정 G6)
export default function Page() {
  return (
    <>
      <PageHeader title="자산 현황" />
      <Suspense>
        <AdjustmentNotice />
      </Suspense>
      <Suspense fallback={<DashboardSkeleton stats={3} panels={2} />}>
        <Overview />
      </Suspense>
    </>
  );
}

// 새로 생긴 잔액 보정 거래 알림(4단계 파일 6.2·6.3). "닫기"를 누를 때까지 보인다.
async function AdjustmentNotice() {
  const user = await requireUser();
  const items = await listAdjustmentNotice(getAppDb(), user.id);
  if (items.length === 0) return null;
  return (
    <Notice
      title="잔액 보정 거래가 생겼습니다"
      action={<DismissNoticeButton />}
    >
      <ul>
        {items.map((item) => (
          <li key={item.accountId}>
            <Link href={`/transactions?account=${item.accountId}&month=${item.lastMonth}`} className="hover:underline">
              {item.accountName}
            </Link>
            <span className="text-notice-foreground/80">
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
  const user = await requireUser();
  const { assets, liabilities, cards, totals } = await getAssetOverview(getAppDb(), user.id);
  if (assets.length + liabilities.length + cards.length === 0) {
    return (
      <Panel>
        <p className="text-muted-foreground">
          계정이 없습니다. <Link href="/accounts" className="underline">계정 관리</Link>에서 만드세요.
        </p>
      </Panel>
    );
  }
  const now = today();

  return (
    <Stack>
      <StatRow>
        <StatCard hero label="순자산" value={<Money value={totals.net} />} sub="자산 − 부채" />
        <StatCard label="자산 합계" value={<Money value={totals.asset} />} sub={`계정 ${assets.length}개`} />
        <StatCard label="부채 합계" value={<Money value={totals.liability} />} sub={`계정 ${liabilities.length}개`} />
      </StatRow>

      {assets.length + liabilities.length > 0 && (
        <Panel title="자산과 부채" aside="계정별 비중">
          <ShareBar label="자산과 부채의 계정별 비중" items={shareItems(assets, liabilities)} />
        </Panel>
      )}

      <Columns>
        <Panel title="자산" aside={<Money value={totals.asset} />}>
          <AccountList rows={assets} kind="asset" now={now} empty="자산 계정이 없습니다." />
        </Panel>
        <div className="flex flex-col gap-3.5">
          <Panel title="부채" aside={<Money value={totals.liability} />}>
            <AccountList rows={liabilities} kind="liability" now={now} empty="부채 계정이 없습니다." />
          </Panel>
          {cards.length > 0 && (
            <Panel title="카드" aside="합계에 넣지 않습니다">
              <ul>
                {cards.map((c) => (
                  <AccountItem
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    kind="card"
                    manual={c.institution == null}
                    detail={<AccountDetail institution={c.institution} end={c.lastPeriodEnd} now={now} />}
                    right={
                      <span className="text-muted-foreground">
                        이번 달 <Money value={c.monthUsage} className="text-foreground" />
                      </span>
                    }
                  />
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </Columns>
    </Stack>
  );
}

const institutionLabel = (institution: AssetRow["institution"]) => (institution ? INSTITUTION_LABELS[institution] : "수동");

function AccountList({ rows, kind, now, empty }: { rows: AssetRow[]; kind: "asset" | "liability"; now: string; empty: string }) {
  if (rows.length === 0) return <p className="py-1 text-muted-foreground">{empty}</p>;
  return (
    <ul>
      {rows.map((a) => (
        <AccountItem
          key={a.id}
          id={a.id}
          name={a.name}
          kind={kind}
          manual={a.institution == null}
          detail={<AccountDetail institution={a.institution} end={a.lastPeriodEnd} now={now} />}
          right={<Money value={a.balance} className="font-semibold" />}
        />
      ))}
    </ul>
  );
}

// 계정 한 줄: 종류 아이콘, 이름과 금융사·올린 기간, 오른쪽 금액. 누르면 그 계정의 거래 목록으로 간다.
function AccountItem({
  id,
  name,
  kind,
  manual,
  detail,
  right,
}: {
  id: number;
  name: string;
  kind: AccountKind;
  manual: boolean;
  detail: ReactNode;
  right: ReactNode;
}) {
  return (
    <li className="border-b last:border-b-0">
      <Link href={`/transactions?account=${id}`} className="flex items-center gap-2.5 py-2 hover:bg-muted/50">
        <AccountKindIcon kind={kind} manual={manual} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
        <span className="shrink-0 text-right">{right}</span>
      </Link>
    </li>
  );
}

function AccountDetail({ institution, end, now }: { institution: AssetRow["institution"]; end: string | null; now: string }) {
  return (
    <>
      {institutionLabel(institution)}
      {end && (
        <>
          {" · "}
          <PeriodEnd end={end} now={now} />
        </>
      )}
    </>
  );
}

// 가장 늦게 올린 끝 날짜와 오늘까지 며칠인지(4.1). 업로드가 없거나 수동 계정이면 비운다.
function PeriodEnd({ end, now }: { end: string | null; now: string }) {
  if (!end) return null;
  const days = daysBetween(end, now);
  return (
    <span className="tabular-nums">
      ~ {end} ({days <= 0 ? "오늘" : `${days}일 전`})
    </span>
  );
}
