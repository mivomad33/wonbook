import { describe, expect, it } from "vitest";
import { matchKeyOf, normalizeMatchText } from "./match-key";

describe("normalizeMatchText", () => {
  // 5단계 파일 3.2의 예
  it.each([
    ["ANTHROPIC                +14152360599 US", "ANTHROPIC"],
    ["AIRBNB * ABCD12EF34", "AIRBNB"],
    ["쿠팡 ((쿠팡페이(주)_펌뱅킹))", "쿠팡"],
    ["(주)우아한형제들", "우아한형제들"],
    ["주식회사 우아한형제들", "우아한형제들"],
    ["우아한형제들", "우아한형제들"],
    ["㈜우아한형제들", "우아한형제들"],
    ["Adobe", "ADOBE"],
    ["청년수당(10월)", "청년수당월"],
    ["청년수당(11월)", "청년수당월"],
    ["희망나눔260810", "희망나눔"],
    ["네이버1234", "네이버"],
    ["네이버5678", "네이버"],
    ["네이버페이", "네이버페이"],
    ["1234케이계좌인증", "케이계좌인증"],
    ["(예금이자 1,000 소득세 140 지방소득세 10)", "예금이자소득세지방소득세"],
    ["GS25 역삼중앙점", "GS역삼중앙점"],
    ["[스마트출금] 홍길동", "스마트출금홍길동"],
  ])("%s → %s", (input, key) => {
    expect(normalizeMatchText(input)).toBe(key);
  });

  it("숫자가 없는 * 꼬리는 지우지 않는다", () => {
    expect(normalizeMatchText("SHOP * ABCDEFGHIJ")).toBe("SHOPABCDEFGHIJ");
  });
});

describe("matchKeyOf", () => {
  it("description으로 만들고, 정규화해 비면 method로 만든다", () => {
    expect(matchKeyOf({ description: "스타벅스", method: "일시불" })).toEqual({ key: "스타벅스", fromMethod: false });
    // 하나은행 청약종합: description이 계좌번호뿐이다(3.1).
    expect(matchKeyOf({ description: "123-456789-01", method: "청약종합" })).toEqual({ key: "청약종합", fromMethod: true });
    expect(matchKeyOf({ description: "", method: "이자" })).toEqual({ key: "이자", fromMethod: true });
  });

  it("둘 다 비면 null", () => {
    expect(matchKeyOf({ description: "12345", method: null })).toBeNull();
    expect(matchKeyOf({ description: "", method: "  " })).toBeNull();
  });
});
