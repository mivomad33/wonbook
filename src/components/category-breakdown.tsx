import type { ReactNode } from "react";
import Link from "next/link";
import { CategoryDot } from "@/components/category-style";
import { Money } from "@/components/money";
import { categoryColorValues } from "@/lib/category-style";
import type { ReportLine } from "@/lib/reports";
import { cn } from "@/lib/utils";

// 카테고리별 구성 목록(design-refresh 명세서 4.3-3·4): 색 점, 이름, 금액, 비율과 그 폭만큼의 막대.
// 음수 금액은 빨간 −로 보이고 비율은 비어 있다(6단계 파일 1.5·2장). 줄을 누르면 그 카테고리 거래 목록으로 간다.
// hrefPrefix가 없으면 누를 수 없는 줄로 그린다(소개 화면의 예시 그림).
export function CategoryBreakdown({ lines, hrefPrefix }: { lines: ReportLine[]; hrefPrefix?: string }) {
  if (lines.length === 0) return <p className="py-1 text-muted-foreground">거래가 없습니다.</p>;
  return (
    <ul className="min-w-0 flex-1">
      {lines.map((l) => (
        <li key={l.categoryId ?? "none"} className="border-b last:border-b-0">
          <Row href={hrefPrefix && `${hrefPrefix}${l.categoryId ?? "none"}`}>
            <CategoryDot color={l.color} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className={cn("truncate", l.categoryId == null && "text-muted-foreground")}>{l.name}</span>
              {l.ratio != null && (
                <span className="h-1 rounded-full bg-muted" aria-hidden="true">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.min(l.ratio, 100)}%`, background: categoryColorValues(l.color).base }}
                  />
                </span>
              )}
            </span>
            <Money value={l.amount} className={cn("text-right", l.amount < 0 && "text-expense")} />
            <span className="text-right text-xs text-muted-foreground tabular-nums">{l.ratio != null ? `${l.ratio}%` : ""}</span>
          </Row>
        </li>
      ))}
    </ul>
  );
}

function Row({ href, children }: { href?: string; children: ReactNode }) {
  const className = "grid grid-cols-[auto_minmax(0,1fr)_auto_2.75rem] items-center gap-x-2.5 py-1.5";
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={cn(className, "hover:bg-muted/50")}>
      {children}
    </Link>
  );
}
