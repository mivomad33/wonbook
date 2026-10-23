// 계정 종류·금융사·거래 종류·카테고리 묶음의 화면 이름. 화면마다 따로 쓰지 않게 한곳에 둔다(2단계 파일 4장).
import type { AccountKind, CategoryGroup, Institution, TransactionKind } from "@/db/schema";

// 묶음 순서(자산 → 부채 → 카드)도 이 순서를 쓴다(2단계 파일 1.1).
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  asset: "자산",
  liability: "부채",
  card: "카드",
};

export const INSTITUTION_LABELS: Record<Institution, string> = {
  hana_bank: "하나은행",
  kb_bank: "국민은행",
  kakao_bank: "카카오뱅크",
  kis: "한국투자증권",
  hana_card: "하나카드",
  kb_card: "국민카드",
};

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  normal: "일반",
  transfer: "이체",
  adjustment: "보정",
};

// 거래 구분 토글. 카드 계정은 환불/사용으로 부른다(2단계 파일 3.1).
export const DIRECTION_LABELS: Record<"account" | "card", Record<"in" | "out", string>> = {
  account: { in: "수입", out: "지출" },
  card: { in: "환불", out: "사용" },
};

// 카테고리 묶음(5단계 파일 1.1). 묶음 순서(지출 → 수입 → 이동)도 이 순서를 쓴다.
export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  expense: "지출",
  income: "수입",
  move: "이동",
};
