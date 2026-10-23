// 하나카드 카드이용내역(xls). 형식은 0단계 파일 1.2, 컬럼 대응은 3단계 파일 1.3, 금액은 9.1(결정 D3).
import { ParseError, expectZero, finishFile, compact, looksLikeDate, optionalText, readTable, rowLabel, text, toDate, toPeriod, toTime, toWon, type RowTransaction } from "./common";
import type { InstitutionParser } from "./types";

const HEADER = [
  "이용일", "이용시간", "이용카드", "승인번호", "가맹점명", "승인금액", "포인트사용", "이용구분",
  "할부기간", "매입", "매입금액", "매입할인금액", "매입취소금액", "상태",
] as const;

export const hanaCardParser: InstitutionParser = {
  institution: "hana_card",
  matches: ([sheet]) => compact(sheet?.[1]?.[0]) === "카드이용내역조회",
  parse([sheet]) {
    const rows: RowTransaction[] = [];
    // 끝부분의 `정상승인건수` 등은 이용일이 날짜가 아니다.
    for (const { rowIndex, record: r } of readTable(sheet, 3, HEADER).filter(({ record }) => looksLikeDate(record["이용일"]))) {
      const where = rowLabel(rowIndex);
      const status = text(r["상태"]);
      // 취소는 원래 승인 행의 상태가 바뀐 것이라 넣지 않는다(0단계 파일 1.2).
      if (status === "취소") continue;
      if (status !== "정상") throw new ParseError(`${where}: 상태 '${status}'은(는) 모르는 값입니다`);
      expectZero(r["포인트사용"], `${where} 포인트사용`);
      expectZero(r["매입할인금액"], `${where} 매입할인금액`);
      expectZero(r["매입취소금액"], `${where} 매입취소금액`);

      const purchase = text(r["매입"]);
      let amount: number;
      if (purchase === "매입") amount = -toWon(r["매입금액"], `${where} 매입금액`);
      else if (purchase === "미매입") amount = -toWon(r["승인금액"], `${where} 승인금액`);
      else throw new ParseError(`${where}: 매입 '${purchase}'은(는) 모르는 값입니다`);

      const usage = text(r["이용구분"]);
      rows.push({
        rowIndex,
        date: toDate(r["이용일"], where),
        time: toTime(r["이용시간"], where),
        amount,
        description: text(r["가맹점명"]),
        method: usage === "할부" ? `할부 ${text(r["할부기간"])}개월` : optionalText(usage),
        memo: null,
        cardLabel: optionalText(r["이용카드"]),
        balanceAfter: null,
        raw: r,
      });
    }
    return finishFile({ institution: "hana_card", accountKey: null, period: toPeriod(sheet[2]?.[0]), rows, order: "newest-first" });
  },
};
