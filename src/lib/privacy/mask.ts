// 계좌번호처럼 긴 숫자 가리기(2.2). 거래 내용·메모·업로드 파일 이름에 상대 계좌번호가 그대로 들어오는 경우가 있어서다.
// 하이픈·공백을 사이에 둔 숫자를 이어서 세고, 숫자가 10자리 이상이면 끝 4자리만 남긴다(예: `****1234`).
// 같은 번호는 늘 같은 모양이 되어 저장된 분류(match_key는 숫자를 지운다)와 집계가 그대로다.
// 브라우저(업로드)·서버(받은 값 다시 확인)·이전 명령이 같이 쓴다.
const NUMBER_RUN = /\d(?:[ -]?\d)+/g;
export const MASK_MIN_DIGITS = 10;

export function maskAccountNumbers(text: string): string;
export function maskAccountNumbers(text: string | null): string | null;
export function maskAccountNumbers(text: string | null): string | null {
  if (text == null) return null;
  return text.replace(NUMBER_RUN, (run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length >= MASK_MIN_DIGITS ? `****${digits.slice(-4)}` : run;
  });
}
