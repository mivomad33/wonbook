import { describe, expect, it } from "vitest";
import { shareItems } from "./asset-share";

// 자산 현황의 비중 막대(design-refresh 명세서 4.2-1): 잔액이 0 이하인 계정은 빼고, 자산은 초록 계열, 부채는 빨강 계열이다.
describe("비중 막대 칸", () => {
  it("잔액 0 이하인 계정을 빼고 자산 뒤에 부채를 둔다", () => {
    const items = shareItems(
      [
        { name: "통장", balance: 1_000 },
        { name: "빈 통장", balance: 0 },
        { name: "마이너스", balance: -500 },
        { name: "비상금", balance: 3_000 },
      ],
      [{ name: "대출", balance: 2_000 }, { name: "갚은 대출", balance: 0 }],
    );
    expect(items.map((i) => [i.name, i.value])).toEqual([
      ["통장", 1_000],
      ["비상금", 3_000],
      ["대출(부채)", 2_000],
    ]);
    expect(items[0].color).toContain("--income");
    expect(items[2].color).toContain("--expense");
    expect(new Set(items.map((i) => i.color)).size).toBe(3);
  });

  it("그릴 것이 없으면 빈 목록이다", () => {
    expect(shareItems([{ name: "빈 통장", balance: 0 }], [])).toEqual([]);
  });
});
