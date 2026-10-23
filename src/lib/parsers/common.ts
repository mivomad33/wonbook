// 금융사 파서가 같이 쓰는 칸 읽기·검사 함수(3단계 파일 1.2).
// 모르는 값은 추측하지 않고 ParseError로 막는다(결정 D9). 행 번호는 엑셀에서 보이는 번호(1부터)다.
import type { Institution } from "@/db/schema";
import { UserError } from "@/lib/user-error";
import type { Cell, ParsedFile, ParsedTransaction, Sheet } from "./types";

export class ParseError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export function rowLabel(rowIndex: number) {
  return `${rowIndex + 1}행`;
}

// 앞뒤 공백을 지운 글자. 전각 공백(U+3000)만 든 칸도 빈 칸이 된다(국민은행 `구분`).
export function text(cell: Cell | undefined): string {
  return String(cell ?? "")
    .replace(/　/g, " ")
    .trim();
}

export function optionalText(cell: Cell | undefined): string | null {
  return text(cell) || null;
}

// 줄바꿈·공백을 모두 지운다. 머리글 비교(`이용\n시간` → `이용시간`)와 띄어쓰기만 다른 값 비교에 쓴다.
export function compact(cell: Cell | undefined): string {
  return text(cell).replace(/\s+/g, "");
}

// 숫자 칸. 쉼표가 든 숫자 문자열도 숫자로 바꾼다. 빈 칸·글자는 오류.
export function toNumber(cell: Cell | undefined, where: string): number {
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  const s = text(cell).replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new ParseError(`${where}: 숫자 '${text(cell)}'을(를) 읽을 수 없습니다`);
  return Number(s);
}

// 원 단위 정수 칸.
export function toWon(cell: Cell | undefined, where: string): number {
  const n = toNumber(cell, where);
  if (!Number.isInteger(n)) throw new ParseError(`${where}: 금액 '${text(cell)}'이(가) 원 단위 정수가 아닙니다`);
  return n;
}

// 0이어야 하는 칸(샘플에서 본 적이 없어 의미를 모르는 값, 1.2).
export function expectZero(cell: Cell | undefined, where: string) {
  if (toNumber(cell, where) !== 0) {
    throw new ParseError(`${where}: 값 '${text(cell)}'이(가) 있습니다. 샘플에서 본 적이 없는 값이라 파서를 고쳐야 합니다`);
  }
}

function isValidDate(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const DATE = /^(\d{4})[.-](\d{2})[.-](\d{2})$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

// `YYYY-MM-DD`나 `YYYY.MM.DD` → `YYYY-MM-DD`
export function toDate(cell: Cell | undefined, where: string): string {
  const s = text(cell);
  const m = DATE.exec(s);
  if (!m || !isValidDate(+m[1], +m[2], +m[3])) throw new ParseError(`${where}: 날짜 '${s}'을(를) 읽을 수 없습니다`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function looksLikeDate(cell: Cell | undefined) {
  return DATE.test(text(cell));
}

// `HH:MM:SS`나 `HH:MM`
export function toTime(cell: Cell | undefined, where: string): string {
  const s = text(cell);
  if (!TIME.test(s)) throw new ParseError(`${where}: 시각 '${s}'을(를) 읽을 수 없습니다`);
  return s;
}

// `날짜 시각` 한 칸
export function toDateTime(cell: Cell | undefined, where: string): { date: string; time: string } {
  const [d, t, ...rest] = text(cell).split(/\s+/);
  if (rest.length > 0) throw new ParseError(`${where}: 거래일시 '${text(cell)}'을(를) 읽을 수 없습니다`);
  return { date: toDate(d, where), time: toTime(t, where) };
}

// 조회기간 글자에서 두 날짜를 찾는다. 구분자는 `~`나 `-`, 줄바꿈·공백이 섞여도 된다.
// 예: `2026-07-19 ~ 2026-10-18`, `2025.10.18 - 2026.10.18`, `[조회기간: 2026.07.19 ~ 2026.10.18]`
export function toPeriod(cell: Cell | undefined): { start: string; end: string } {
  const s = text(cell);
  const m = /(\d{4}[.-]\d{2}[.-]\d{2})\s*[~-]\s*(\d{4}[.-]\d{2}[.-]\d{2})/.exec(s);
  if (!m) throw new ParseError(`조회기간 '${s}'을(를) 읽을 수 없습니다`);
  const start = toDate(m[1], "조회기간");
  const end = toDate(m[2], "조회기간");
  if (start > end) throw new ParseError(`조회기간 '${s}'의 시작이 끝보다 늦습니다`);
  return { start, end };
}

// 한 행에서 이름표 칸(`계좌번호`, `조회기간` 등) 바로 오른쪽 칸의 글자. 없으면 오류.
export function labeledValue(sheet: Sheet, rowIndex: number, label: string): string {
  const row = sheet[rowIndex] ?? [];
  const i = row.findIndex((c) => compact(c) === compact(label));
  const value = i < 0 ? "" : text(row[i + 1]);
  if (!value) throw new ParseError(`${rowLabel(rowIndex)}에 ${label}이(가) 없습니다`);
  return value;
}

export type TableRow = { rowIndex: number; record: Record<string, Cell> };

// 머리글 행이 expected와 같은지 검사하고, 그 아래 행을 머리글 이름으로 된 레코드로 바꾼다.
// 머리글이 다르면 금융사가 형식을 바꾼 것이라 오류로 막는다(1.2). 머리글 뒤의 빈 칸은 무시한다.
// 모든 칸이 빈 행은 뺀다.
export function readTable(sheet: Sheet, headerRow: number, expected: readonly string[], startCol = 0): TableRow[] {
  const header = (sheet[headerRow] ?? []).slice(startCol).map(compact);
  while (header.length > expected.length && header[header.length - 1] === "") header.pop();
  const want = expected.map(compact);
  if (header.length !== want.length || header.some((h, i) => h !== want[i])) {
    throw new ParseError(
      `${rowLabel(headerRow)}의 컬럼 머리글이 예상과 다릅니다(금융사가 파일 형식을 바꿨을 수 있습니다). ` +
        `예상: ${want.join(", ")} / 파일: ${header.join(", ")}`,
    );
  }
  const rows: TableRow[] = [];
  for (let r = headerRow + 1; r < sheet.length; r++) {
    const cells = (sheet[r] ?? []).slice(startCol);
    if (cells.every((c) => text(c) === "")) continue;
    const record: Record<string, Cell> = {};
    want.forEach((key, i) => (record[key] = cells[i] ?? ""));
    rows.push({ rowIndex: r, record });
  }
  return rows;
}

// 입금액·출금액 두 칸을 금액 하나로. 둘 다 0이거나 둘 다 0이 아니면 오류.
export function inMinusOut(inCell: Cell | undefined, outCell: Cell | undefined, where: string): number {
  const inAmount = toWon(inCell, `${where} 입금액`);
  const outAmount = toWon(outCell, `${where} 출금액`);
  if ((inAmount === 0) === (outAmount === 0)) {
    throw new ParseError(`${where}: 입금액(${inAmount})과 출금액(${outAmount}) 중 하나만 있어야 합니다`);
  }
  return inAmount - outAmount;
}

export type RowTransaction = Omit<ParsedTransaction, "description"> & { description: string | null; rowIndex: number };

// 금융사 파서가 모은 거래를 ParsedFile로 마무리한다. 모든 금융사 공통 규칙(1.2·1.3·2장)을 여기서 지킨다.
// - 최신순 파일은 행 순서를 뒤집는다. 날짜·시각으로 다시 정렬하지 않는다(같은 초 거래의 순서는 행 순서로만 알 수 있다).
// - description이 비면 method를 넣는다.
// - 금액은 0이 아닌 원 단위 정수, 거래 일자는 조회기간 안이어야 한다.
export function finishFile(args: {
  institution: Institution;
  accountKey: string | null;
  period: { start: string; end: string };
  rows: RowTransaction[];
  order: "newest-first" | "oldest-first";
}): ParsedFile {
  const { period } = args;
  const rows = args.order === "newest-first" ? [...args.rows].reverse() : args.rows;
  const transactions = rows.map(({ rowIndex, ...tx }): ParsedTransaction => {
    const where = rowLabel(rowIndex);
    if (!Number.isInteger(tx.amount) || tx.amount === 0) throw new ParseError(`${where}: 금액이 0이거나 정수가 아닙니다(${tx.amount})`);
    if (tx.date < period.start || tx.date > period.end) {
      throw new ParseError(`${where}: 거래일 ${tx.date}이(가) 조회기간(${period.start} ~ ${period.end}) 밖에 있습니다`);
    }
    return { ...tx, description: tx.description || tx.method || "" };
  });
  return { institution: args.institution, accountKey: args.accountKey, period, transactions };
}
