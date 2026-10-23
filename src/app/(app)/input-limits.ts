// 화면 입력란 길이 상한(4.10-4). 입력란의 maxLength와 서버 동작의 검사가 같은 값을 쓴다.
import type { FormState } from "@/lib/form-state";

// 계정 이름, 카테고리 이름, 거래 내용·메모
export const TEXT_MAX = 100;

export const TEXT_MAX_MESSAGE = `${TEXT_MAX}자까지 입력할 수 있습니다.`;

// 서버 동작용. 상한을 넘는 칸이 있으면 칸 오류를 돌려준다. 앞뒤 공백은 저장할 때 지우므로 빼고 센다.
export function textLimitErrors(values: Record<string, unknown>, fields: readonly string[]): FormState | null {
  const fieldErrors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f];
    if (typeof v === "string" && v.trim().length > TEXT_MAX) fieldErrors[f] = TEXT_MAX_MESSAGE;
  }
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : null;
}
