import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 테두리 있는 흰 상자(design-refresh 확정안). 화면의 묶음(표, 그래프, 목록)을 담는다.
export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card px-4 py-3.5", className)}>
      {(title || aside) && (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// 화면의 묶음을 세로로 쌓는다. 화면 제목(PageHeader) 아래 본문을 감싼다.
export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3.5", className)}>{children}</div>;
}

// 나란히 두는 묶음. 좁은 폭(md 아래)에서는 위아래로 쌓인다.
export function Columns({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-3.5 md:grid-cols-2 md:items-start", className)}>{children}</div>;
}

// 요약 카드(확정안의 "순자산", "자산 합계"). hero는 옅은 초록 강조 카드다. 좁은 폭에서는 두 칸으로 접힌다(4.8-2).
export function StatCard({
  label,
  value,
  sub,
  icon,
  hero = false,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  hero?: boolean;
  /** 좁은 자리(소개 화면 예시 그림)에 둘 때: 금액 글자를 줄인다. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3",
        hero ? "col-span-2 border-brand-soft-foreground/15 bg-brand-soft text-brand-soft-foreground md:col-span-1" : "bg-card",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-xs", hero ? "text-brand-soft-foreground" : "text-muted-foreground")}>
        {icon}
        {label}
      </span>
      <span className={cn("font-bold tracking-tight tabular-nums", compact ? "text-base" : "text-lg md:text-[21px]")}>{value}</span>
      {sub && <span className={cn("text-xs", hero ? "text-brand-soft-foreground" : "text-muted-foreground")}>{sub}</span>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 md:flex md:gap-3.5 md:*:flex-1">{children}</div>;
}
