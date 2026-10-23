// "계정 만들고 올리기"로 만드는 새 계정의 기초 잔액(3단계 파일 3장). DB 없이 파일만 보고 계산한다.
import { shiftDate } from "@/lib/format";
import type { ParsedFile } from "@/lib/parsers";

// 은행·증권 파일: 기준일은 조회기간 시작 전날, 기초 잔액은 가장 오래된 거래 직전 잔액(balanceAfter − amount).
// 조회기간 안의 거래는 모두 기준일 뒤라 잔액에 그대로 더해져, 결과가 파일의 마지막 잔액과 같아진다(design.md 1.3-D).
// 거래가 없는 파일과 카드(거래 후 잔액이 없다)는 0, 기준일 없음.
export function openingFromFile(parsed: ParsedFile): { openingBalance: number; openingDate: string | null } {
  const first = parsed.transactions[0];
  if (!first || first.balanceAfter == null) return { openingBalance: 0, openingDate: null };
  return { openingBalance: first.balanceAfter - first.amount, openingDate: shiftDate(parsed.period.start, -1) };
}
