import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 작은 회색 배지(design.md 3.2). 거래 표시(이체·수동·수정함·보정)와 5단계 카테고리가 쓴다.
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded bg-muted px-1.5 py-px text-xs whitespace-nowrap text-muted-foreground", className)}>
      {children}
    </span>
  );
}
