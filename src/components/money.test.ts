import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Money } from "./money";

const html = (props: Parameters<typeof Money>[0]) => renderToStaticMarkup(createElement(Money, props));

// 금액 색(design-refresh 명세서 4.1-3): 거래 금액은 양수 초록, 음수 빨강, 0과 잔액·합계는 색이 없다.
describe("Money", () => {
  it("signed면 양수는 수입 색, 음수는 지출 색, 0은 색이 없다", () => {
    expect(html({ value: 1200, signed: true })).toContain("text-income");
    expect(html({ value: -1200, signed: true })).toContain("text-expense");
    const zero = html({ value: 0, signed: true });
    expect(zero).not.toContain("text-income");
    expect(zero).not.toContain("text-expense");
  });

  it("signed가 아니면 색이 없고, plus면 양수에 +를 붙인다", () => {
    const plain = html({ value: -1200 });
    expect(plain).not.toMatch(/text-(income|expense)/);
    expect(plain).toContain("-1,200원");
    expect(html({ value: 1200, plus: true })).toContain("+1,200원");
  });
});
