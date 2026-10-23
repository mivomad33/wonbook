// 국민은행 거래내역조회(xls). 형식은 0단계 파일 1.4, 컬럼 대응은 3단계 파일 1.3.
import { finishFile, compact, inMinusOut, labeledValue, optionalText, readTable, rowLabel, text, toDateTime, toPeriod, toWon } from "./common";
import type { InstitutionParser } from "./types";

const HEADER = ["거래일시", "적요", "보낸분/받는분", "송금메모", "출금액", "입금액", "잔액", "거래점", "구분"] as const;

export const kbBankParser: InstitutionParser = {
  institution: "kb_bank",
  matches: ([sheet]) => compact(sheet?.[0]?.[0]) === "조회기간" && compact(sheet?.[1]?.[0]) === "계좌번호",
  parse([sheet]) {
    const rows = readTable(sheet, 4, HEADER)
      // 끝의 합계 행: 송금메모 칸이 `합계`이고 거래일시가 비어 있다.
      .filter(({ record }) => !(text(record["송금메모"]) === "합계" && text(record["거래일시"]) === ""))
      .map(({ rowIndex, record: r }) => {
        const where = rowLabel(rowIndex);
        const description = text(r["보낸분/받는분"]);
        const memo = optionalText(r["송금메모"]);
        return {
          rowIndex,
          ...toDateTime(r["거래일시"], where),
          amount: inMinusOut(r["입금액"], r["출금액"], where),
          description,
          method: optionalText(r["적요"]),
          // 송금메모는 대개 받는 분 이름과 같다(띄어쓰기만 다르기도 하다). 다를 때만 메모로 둔다.
          memo: memo && compact(memo) !== compact(description) ? memo : null,
          cardLabel: null,
          balanceAfter: toWon(r["잔액"], `${where} 잔액`),
          raw: r,
        };
      });
    return finishFile({
      institution: "kb_bank",
      accountKey: labeledValue(sheet, 1, "계좌번호"),
      period: toPeriod(labeledValue(sheet, 0, "조회기간")),
      rows,
      order: "newest-first",
    });
  },
};
