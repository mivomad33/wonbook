// 하나은행 거래내역조회(xls). 형식은 0단계 파일 1.1, 컬럼 대응은 3단계 파일 1.3, 청약 계좌 파일은 changes/1-hana-subscription.md.
import { ParseError, finishFile, compact, inMinusOut, labeledValue, optionalText, readTable, rowLabel, text, toDateTime, toPeriod, toWon } from "./common";
import type { Cell, InstitutionParser } from "./types";

const HEADER = ["거래일시", "구분", "적요", "출금액", "입금액", "잔액", "거래점"] as const;
// 청약 계좌 파일은 입금 컬럼만 다르다. 값은 `20,000(91)`처럼 금액 뒤에 납부 회차가 붙는다.
const SUBSCRIPTION_DEPOSIT = "입금(납부회차)";
const SUBSCRIPTION_HEADER = ["거래일시", "구분", "적요", "출금액", SUBSCRIPTION_DEPOSIT, "잔액", "거래점"] as const;

// 청약 입금 칸: 숫자이거나 `금액(회차)`. 회차는 raw에만 남는다(변경 1 결정 2).
function subscriptionDeposit(cell: Cell | undefined, where: string): number {
  if (typeof cell === "number") return toWon(cell, where);
  const m = /^([\d,]+)\((\d+)\)$/.exec(compact(cell));
  if (!m) throw new ParseError(`${where}: 입금 '${text(cell)}'을(를) 읽을 수 없습니다. '금액(회차)' 형식이어야 합니다`);
  return toWon(m[1], where);
}

export const hanaBankParser: InstitutionParser = {
  institution: "hana_bank",
  matches: ([sheet]) => compact(sheet?.[0]?.[0]) === "거래내역조회" && compact(sheet?.[2]?.[0]) === "계좌번호",
  parse([sheet]) {
    const subscription = compact(sheet[5]?.[4]) === SUBSCRIPTION_DEPOSIT;
    const rows = readTable(sheet, 5, subscription ? SUBSCRIPTION_HEADER : HEADER)
      .filter(({ record }) => compact(record["적요"]) !== "합계")
      .map(({ rowIndex, record: r }) => {
        const where = rowLabel(rowIndex);
        return {
          rowIndex,
          ...toDateTime(r["거래일시"], where),
          amount: inMinusOut(subscription ? subscriptionDeposit(r[SUBSCRIPTION_DEPOSIT], `${where} 입금액`) : r["입금액"], r["출금액"], where),
          description: text(r["적요"]),
          method: optionalText(r["구분"]),
          memo: null,
          cardLabel: null,
          balanceAfter: toWon(r["잔액"], `${where} 잔액`),
          raw: r,
        };
      });
    return finishFile({
      institution: "hana_bank",
      accountKey: labeledValue(sheet, 2, "계좌번호"),
      period: toPeriod(labeledValue(sheet, 2, "조회기간")),
      rows,
      order: "newest-first",
    });
  },
};
