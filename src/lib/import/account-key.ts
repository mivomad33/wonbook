// 계정 찾기 값 정규화(3단계 파일 3장). 파일의 계좌번호와 계정의 external_key를 같은 함수로 바꿔 비교한다.
// 계정 폼(클라이언트)도 저장할 때 불러 쓰므로 DB 코드를 두지 않는다.
import type { Institution } from "@/db/schema";

// 숫자만 남긴다(하이픈·공백 제거). 카카오뱅크는 파일에서 가운데가 가려져 끝 4자리만 쓴다.
// 카드사는 계정 찾기 값을 쓰지 않는다(design.md 1.3-B). 숫자가 하나도 없으면 null이다.
export function normalizeAccountKey(institution: Institution | null, key: string | null): string | null {
  if (institution === "hana_card" || institution === "kb_card") return null;
  const digits = (key ?? "").replace(/\D/g, "");
  if (digits === "") return null;
  return institution === "kakao_bank" ? digits.slice(-4) : digits;
}
