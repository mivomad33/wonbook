// 공통 내비게이션 메뉴(design.md 2.2 순서). 화면을 만든 단계에서 ready를 true로 바꾼다.
export const NAV_ITEMS = [
  { href: "/", label: "자산 현황", ready: true, stage: 6 },
  { href: "/monthly", label: "월별 수입/지출", ready: true, stage: 6 },
  { href: "/transactions", label: "거래 목록", ready: true, stage: 2 },
  { href: "/upload", label: "파일 업로드", ready: true, stage: 3 },
  { href: "/accounts", label: "계정 관리", ready: true, stage: 2 },
  { href: "/categories", label: "카테고리", ready: true, stage: 5 },
] as const;

export type NavHref = (typeof NAV_ITEMS)[number]["href"];
