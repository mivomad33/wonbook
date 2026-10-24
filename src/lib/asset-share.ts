// 자산 현황의 자산과 부채 비중 막대 칸(design-refresh 명세서 4.2-1). 자산은 초록 계열, 부채는 빨강 계열로 계정마다 칸을 나눈다.
// 잔액이 0 이하인 계정은 막대와 범례에서 뺀다. 색은 금액 색 토큰을 흰색과 섞어 옅게 만든다.
const SHADES = [100, 70, 48, 32, 22];

const shade = (token: string, i: number) => `color-mix(in oklab, var(${token}) ${SHADES[i % SHADES.length]}%, white)`;

export function shareItems(
  assets: readonly { name: string; balance: number }[],
  liabilities: readonly { name: string; balance: number }[],
): { name: string; value: number; color: string }[] {
  return [
    ...assets.filter((a) => a.balance > 0).map((a, i) => ({ name: a.name, value: a.balance, color: shade("--income", i) })),
    ...liabilities
      .filter((a) => a.balance > 0)
      .map((a, i) => ({ name: `${a.name}(부채)`, value: a.balance, color: shade("--expense", i + 2) })),
  ];
}
