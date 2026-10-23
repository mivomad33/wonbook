// 파일 하나를 읽어 ParsedFile로 바꾼다(3단계 파일 1.1).
import { ParseError } from "./common";
import { hanaBankParser } from "./hana-bank";
import { hanaCardParser } from "./hana-card";
import { kakaoBankParser } from "./kakao-bank";
import { kbBankParser } from "./kb-bank";
import { kbCardParser } from "./kb-card";
import { kisParser } from "./kis";
import { UNSUPPORTED_FILE, readSheets } from "./read-file";
import type { InstitutionParser, ParsedFile, Sheet } from "./types";

export { ParseError } from "./common";
export type { ParsedFile, ParsedTransaction } from "./types";

export const PARSERS: readonly InstitutionParser[] = [
  hanaBankParser,
  kbBankParser,
  kakaoBankParser,
  hanaCardParser,
  kbCardParser,
  kisParser,
];

// 맞는 파서가 없으면 지원하지 않는 파일, 둘 이상이면 코드 오류다(테스트로 막는다).
export function findParser(sheets: Sheet[]): InstitutionParser {
  const found = PARSERS.filter((p) => p.matches(sheets));
  if (found.length === 0) throw new ParseError(UNSUPPORTED_FILE);
  if (found.length > 1) throw new Error(`파서 여러 개가 같은 파일에 맞습니다: ${found.map((p) => p.institution).join(", ")}`);
  return found[0];
}

export async function parseFile(input: Uint8Array, options: { password?: string } = {}): Promise<ParsedFile> {
  const sheets = await readSheets(input, options);
  return findParser(sheets).parse(sheets);
}
