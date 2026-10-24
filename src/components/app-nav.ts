import { ArrowLeftRight, BarChart3, Landmark, ListOrdered, Settings, Shield, Tags, Upload, type LucideIcon } from "lucide-react";

// 공통 내비게이션 메뉴(design.md 2.2 순서). 설정은 아래쪽, 관리자는 관리자에게만 보인다.
// 메뉴마다 lucide 아이콘을 둔다(design-refresh 명세서 4.1-1).
export const NAV_ITEMS = [
  { href: "/home", label: "자산 현황", icon: Landmark },
  { href: "/monthly", label: "월별 수입/지출", icon: BarChart3 },
  { href: "/transactions", label: "거래 목록", icon: ArrowLeftRight },
  { href: "/upload", label: "파일 업로드", icon: Upload },
  { href: "/accounts", label: "계정 관리", icon: ListOrdered },
  { href: "/categories", label: "카테고리", icon: Tags },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon }[];

export const SETTINGS_NAV = { href: "/settings", label: "설정", icon: Settings } as const;
export const ADMIN_NAV = { href: "/admin", label: "관리자", icon: Shield } as const;

export type NavHref = (typeof NAV_ITEMS)[number]["href"];
