// 국민카드 카드이용내역(xls). 형식은 0단계 파일 1.5, 컬럼 대응은 3단계 파일 1.3, 금액은 9.1·9.2(결정 D2·D3).
import { ParseError, finishFile, compact, labeledValue, optionalText, readTable, rowLabel, text, toDate, toNumber, toPeriod, toTime, toWon, type RowTransaction } from "./common";
import type { InstitutionParser } from "./types";

const HEADER = [
  "이용일", "이용시간", "이용고객명", "이용카드명", "이용하신곳", "국내이용금액(원)", "해외이용금액($)", "결제방법",
  "가맹점정보", "할인금액", "적립(예상)포인트리", "상태", "결제예정일", "승인번호",
] as const;

// 해외 결제의 원화 금액을 어림할 고정 환율(원/달러, 결정 D2).
// 2026-10-19 구현 때 확인한 가장 최근 공개 환율(2026-07-10 약 1,501원)로 정했다. 크게 바뀌면 고친다.
export const USD_KRW_RATE = 1500;

// 상태별 부호. 승인취소는 넣지 않는다(null). 표에 없는 상태는 오류다.
const STATUS_SIGN: Record<string, -1 | 1 | null> = {
  전표매입: -1,
  EDC특약가맹점취소승인발생매출건: -1,
  취소전표매입: 1, // 환불. 원래 결제와 짝을 맞추지 않는다.
  승인취소: null,
};

export const kbCardParser: InstitutionParser = {
  institution: "kb_card",
  matches: ([sheet]) => compact(sheet?.[1]?.[0]) === "조회기간" && compact(sheet?.[2]?.[0]) === "카드번호",
  parse([sheet]) {
    const rows: RowTransaction[] = [];
    for (const { rowIndex, record: r } of readTable(sheet, 6, HEADER)) {
      const where = rowLabel(rowIndex);
      const status = text(r["상태"]);
      if (!(status in STATUS_SIGN)) throw new ParseError(`${where}: 상태 '${status}'은(는) 모르는 값입니다`);
      const sign = STATUS_SIGN[status];
      if (sign === null) continue;

      const domestic = toWon(r["국내이용금액(원)"], `${where} 국내이용금액`);
      const overseas = toNumber(r["해외이용금액($)"], `${where} 해외이용금액`);
      const discount = toWon(r["할인금액"], `${where} 할인금액`);
      let method = optionalText(r["결제방법"]);
      let charged: number;
      if (overseas === 0) {
        charged = domestic - discount; // 실제 청구액(결정 D3)
      } else if (domestic === 0 && discount === 0 && overseas > 0) {
        charged = Math.round(overseas * USD_KRW_RATE);
        method = method ? `${method} 해외(어림)` : "해외(어림)";
      } else {
        throw new ParseError(`${where}: 국내이용금액(${domestic})·해외이용금액(${overseas})·할인금액(${discount}) 조합을 모릅니다`);
      }
      if (charged < 0) throw new ParseError(`${where}: 할인금액(${discount})이 이용금액(${domestic})보다 큽니다`);
      if (charged === 0) continue; // 전액 할인

      rows.push({
        rowIndex,
        date: toDate(r["이용일"], where),
        time: toTime(r["이용시간"], where),
        amount: sign * charged,
        description: text(r["이용하신곳"]),
        method,
        memo: null,
        cardLabel: optionalText(r["이용카드명"]),
        balanceAfter: null,
        raw: r,
      });
    }
    return finishFile({
      institution: "kb_card",
      accountKey: null,
      period: toPeriod(labeledValue(sheet, 1, "조회기간")),
      rows,
      order: "newest-first",
    });
  },
};
