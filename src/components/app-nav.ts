// 공통 내비게이션 메뉴(design.md 2.2 순서). 설정은 아래쪽, 관리자는 관리자에게만 보인다.
export const NAV_ITEMS = [
  { href: "/home", label: "자산 현황" },
  { href: "/monthly", label: "월별 수입/지출" },
  { href: "/transactions", label: "거래 목록" },
  { href: "/upload", label: "파일 업로드" },
  { href: "/accounts", label: "계정 관리" },
  { href: "/categories", label: "카테고리" },
] as const;

export type NavHref = (typeof NAV_ITEMS)[number]["href"];
