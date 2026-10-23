// 미분류로 남은 이유(5단계 파일 5.2, 6장). 클라이언트 컴포넌트도 쓰므로 DB 코드와 떼어 둔다.
export type ClassifyError = { kind: "no_key" } | { kind: "failed"; message: string };

export function classifyErrorMessage(error: ClassifyError): string {
  return error.kind === "no_key"
    ? "Claude API 키가 없어 분류하지 못했습니다(.env.local의 ANTHROPIC_API_KEY)."
    : `Claude API 호출이 실패했습니다: ${error.message}`;
}
