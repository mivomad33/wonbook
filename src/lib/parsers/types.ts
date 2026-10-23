// 파서의 공통 입력·출력 형식(3단계 파일 1.2).
import type { Institution } from "@/db/schema";

export type Cell = string | number;
export type Sheet = Cell[][];

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SS 또는 HH:MM
  amount: number; // 원 단위 정수, 0이 아님. 부호는 design.md 1.1
  description: string;
  method: string | null;
  memo: string | null;
  cardLabel: string | null;
  balanceAfter: number | null;
  raw: Record<string, Cell>; // 원래 행. 키는 컬럼 머리글(줄바꿈·공백 제거)
};

export type ParsedFile = {
  institution: Institution;
  accountKey: string | null; // 계정 찾기 값. 정규화 전 원래 값(카드는 null)
  period: { start: string; end: string }; // 덮어쓸 기간(3단계 파일 2장)
  transactions: ParsedTransaction[]; // 오래된 순
};

export type InstitutionParser = {
  institution: Institution;
  matches(sheets: Sheet[]): boolean;
  parse(sheets: Sheet[]): ParsedFile;
};
