// 저장된 분류를 찾는 키(5단계 파일 3장). 화면에 보이지 않으므로 읽기 좋을 필요가 없다.

// description 하나를 정규화한다(3.2). 결과가 빈 문자열일 수 있다.
export function normalizeMatchText(text: string): string {
  return (
    text
      // 1. 해외 가맹점 꼬리: `+전화번호 국가코드`, 숫자가 섞인 예약·주문 번호
      .replace(/\s+\+\d{6,}\s+[A-Z]{2}$/, "")
      .replace(/\s*\*\s*([A-Z0-9]{8,})$/, (m, code: string) => (/\d/.test(code) ? "" : m))
      // 2. 하나은행 결제 경로 `((…))`
      .replace(/\s*\(\(.*\)\)\s*$/, "")
      // 3. ㈜ → (주) 같은 호환 문자를 풀고 영문을 대문자로
      .normalize("NFKC")
      .toUpperCase()
      // 4. 회사 표시
      .replace(/\(주\)|주\)|주식회사|유한회사|\(유\)/g, "")
      // 5. 거래마다 바뀌는 숫자(회차·월·인증 번호·지점 번호)
      .replace(/\d/g, "")
      // 6. 한글·영문 말고는 모두(공백, 괄호, 기호)
      .replace(/[^\p{Script=Hangul}A-Z]/gu, "")
  );
}

export type MatchKey = {
  key: string;
  // description이 비어 method로 만든 키. 이런 거래는 API에 description 원문을 보내지 않는다(4.2).
  fromMethod: boolean;
};

// description으로 만들고, 비면 method로 만든다. 둘 다 비면 null(분류하지 않고 미분류로 둔다, 3.1).
export function matchKeyOf(t: { description: string; method: string | null }): MatchKey | null {
  const key = normalizeMatchText(t.description);
  if (key) return { key, fromMethod: false };
  const byMethod = normalizeMatchText(t.method ?? "");
  return byMethod ? { key: byMethod, fromMethod: true } : null;
}
