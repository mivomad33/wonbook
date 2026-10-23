// 거래 목록의 거르기 조건(URL 쿼리, 2단계 파일 2.1). 화면(클라이언트)도 불러 쓰므로 DB 코드를 두지 않는다.

// 계정 종류 묶음: account는 자산·부채, card는 카드(design.md 2.1)
export type AccountGroup = "account" | "card";

export type TransactionFilter = {
  accountId: number | null;
  // accountId가 있으면 무시한다.
  group: AccountGroup | null;
  // `YYYY-MM` 또는 전체 기간
  month: string | "all";
  // 카테고리 id 또는 미분류("none"). null이면 전체(5단계 파일 7.1).
  categoryId: number | "none" | null;
  showDeleted: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// month 쿼리(`YYYY-MM` 또는 전체 기간 all). 잘못된 값이나 없으면 이번 달이다. 월별 수입/지출(6단계)도 쓴다.
export function parseMonth(value: string | string[] | undefined, thisMonth: string): string | "all" {
  const month = first(value);
  return month === "all" || (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) ? month : thisMonth;
}

// 잘못된 값은 없는 것으로 본다. 월 쿼리가 없으면 이번 달이다.
export function parseTransactionFilter(params: SearchParams, thisMonth: string): TransactionFilter {
  const account = Number(first(params.account));
  const kind = first(params.kind);
  const category = first(params.category);
  const categoryId = Number(category);
  return {
    accountId: Number.isInteger(account) && account > 0 ? account : null,
    group: kind === "account" || kind === "card" ? kind : null,
    month: parseMonth(params.month, thisMonth),
    categoryId: category === "none" ? "none" : Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null,
    showDeleted: first(params.deleted) === "1",
  };
}
