// 미분류로 남은 이유(5단계 파일 5.2, 6장). 클라이언트 컴포넌트도 쓰므로 DB 코드와 떼어 둔다.
export type ClassifyError = { kind: "no_key" } | { kind: "failed"; message: string };

export function classifyErrorMessage(error: ClassifyError): string {
  return error.kind === "no_key"
    ? "Claude API 키가 없어 분류하지 못했습니다(.env.local의 ANTHROPIC_API_KEY)."
    : `Claude API 호출이 실패했습니다: ${error.message}`;
}

// 분류 한도 때문에 남은 미분류 안내(4.4-2). 숫자는 서버의 설정값(classifyLimits().userDaily)을 받아 쓴다.
export function classifyLimitMessage(userDailyLimit: number): string {
  return `하루 분류 한도(${userDailyLimit.toLocaleString("ko-KR")}건) 때문에 미분류로 남은 거래가 있습니다. 내일 다시 분류할 수 있습니다.`;
}
