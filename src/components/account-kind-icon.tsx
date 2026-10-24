import { Banknote, CreditCard, HandCoins, Landmark } from "lucide-react";
import type { AccountKind } from "@/db/schema";
import { cn } from "@/lib/utils";

// 계정 종류 아이콘(design-refresh 명세서 4.2-1·4.6-1). 자산 현황과 계정 관리가 같이 쓴다. 금융사가 없는 수동 자산은 지폐 모양이다.
export function AccountKindIcon({ kind, manual = false, className }: { kind: AccountKind; manual?: boolean; className?: string }) {
  const Icon = kind === "card" ? CreditCard : kind === "liability" ? HandCoins : manual ? Banknote : Landmark;
  return (
    <span aria-hidden="true" className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", className)}>
      <Icon className="size-4" />
    </span>
  );
}
