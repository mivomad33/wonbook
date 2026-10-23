// 카카오뱅크 거래내역(암호 걸린 xlsx). 형식은 0단계 파일 1.3, 컬럼 대응은 3단계 파일 1.3.
import { ParseError, finishFile, compact, labeledValue, optionalText, readTable, rowLabel, text, toDateTime, toPeriod, toWon } from "./common";
import type { Cell, InstitutionParser } from "./types";

const HEADER = ["거래일시", "구분", "거래금액", "거래 후 잔액", "거래구분", "내용", "메모"] as const;

// 부호는 `-` 표기 대신 `구분`을 믿는다(샘플에 출금이 없어 `-` 표기를 직접 보지 못했다).
function signedAmount(kind: string, amountCell: Cell, where: string) {
  const s = text(amountCell);
  const negative = s.startsWith("-");
  const abs = toWon(negative ? s.slice(1) : s, `${where} 거래금액`);
  if (kind === "입금") {
    if (negative) throw new ParseError(`${where}: 구분이 입금인데 거래금액 '${s}'에 -가 있습니다`);
    return abs;
  }
  if (kind === "출금") return -abs;
  throw new ParseError(`${where}: 구분 '${kind}'은(는) 모르는 값입니다`);
}

export const kakaoBankParser: InstitutionParser = {
  institution: "kakao_bank",
  matches: ([sheet]) => compact(sheet?.[0]?.[1]) === "카카오뱅크거래내역",
  parse([sheet]) {
    // A열은 비어 있고 B열부터 내용이 있다.
    const rows = readTable(sheet, 10, HEADER, 1).map(({ rowIndex, record: r }) => {
      const where = rowLabel(rowIndex);
      const kind = text(r["구분"]);
      return {
        rowIndex,
        ...toDateTime(r["거래일시"], where),
        amount: signedAmount(kind, r["거래금액"], where),
        description: text(r["내용"]),
        method: optionalText(r["거래구분"]) ?? optionalText(kind),
        memo: optionalText(r["메모"]),
        cardLabel: null,
        balanceAfter: toWon(r["거래후잔액"], `${where} 거래 후 잔액`),
        raw: r,
      };
    });
    return finishFile({
      institution: "kakao_bank",
      accountKey: labeledValue(sheet, 4, "계좌번호"),
      period: toPeriod(labeledValue(sheet, 3, "조회기간")),
      rows,
      order: "oldest-first",
    });
  },
};
