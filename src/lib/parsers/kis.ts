// 한국투자증권 입출금거래내역(확장자만 xls인 HTML). 일반·ISA 같은 파서.
// 형식은 0단계 파일 1.6, 컬럼 대응은 3단계 파일 1.3, 일반 계좌 세금은 4장(결정 D4: 세전 금액 그대로).
import { ParseError, expectZero, finishFile, compact, labeledValue, readTable, rowLabel, text, toDate, toPeriod, toTime, toWon, type RowTransaction } from "./common";
import type { Cell, InstitutionParser } from "./types";

// 거래 하나가 `<tr>` 2개에 걸친다. rowspan 칸(거래종류·수수료·잔액)은 첫 줄에만 있다.
const HEADER_1 = ["거래일", "거래종류", "입금액", "수수료", "잔액", "출금표시내용", "상대계좌", "상대금융기관"] as const;
const HEADER_2 = ["거래시각", "출금액", "입금표시내용", "상대계좌명", "거래채널"] as const;

export const kisParser: InstitutionParser = {
  institution: "kis",
  matches: (sheets) =>
    sheets.length === 5 && compact(sheets[0]?.[0]?.[0]) === "계좌정보" && compact(sheets[0]?.[1]?.[0]) === "거래구분",
  parse(sheets) {
    const [info, , , , table] = sheets;
    // 머리글 2줄(1·2행)을 각각 검사하고, 3행부터 2줄씩 거래 하나로 묶는다.
    readTable(table.slice(0, 2), 1, HEADER_1);
    readTable(table.slice(0, 3), 2, HEADER_2);
    if ((table.length - 3) % 2 !== 0) throw new ParseError("거래 행 수가 홀수입니다(거래 하나가 2줄이어야 합니다)");

    const rows: RowTransaction[] = [];
    for (let rowIndex = 3; rowIndex < table.length; rowIndex += 2) {
      const [first, second] = [table[rowIndex], table[rowIndex + 1]];
      if (first.length !== HEADER_1.length || second.length !== HEADER_2.length) {
        throw new ParseError(`${rowLabel(rowIndex)}: 거래 2줄의 칸 수가 ${HEADER_1.length}개·${HEADER_2.length}개가 아닙니다`);
      }
      const r: Record<string, Cell> = {};
      HEADER_1.forEach((key, j) => (r[compact(key)] = first[j]));
      HEADER_2.forEach((key, j) => (r[compact(key)] = second[j]));

      const where = rowLabel(rowIndex);
      expectZero(r["수수료"], `${where} 수수료`); // 출금액에 들어 있는지 몰라 0이어야 한다
      const inAmount = toWon(r["입금액"], `${where} 입금액`);
      const outAmount = toWon(r["출금액"], `${where} 출금액`);
      if (inAmount === 0 && outAmount === 0) continue; // `… USD` 행: 원화 금액이 없다
      if (inAmount !== 0 && outAmount !== 0) throw new ParseError(`${where}: 입금액(${inAmount})과 출금액(${outAmount})이 모두 있습니다`);

      rows.push({
        rowIndex,
        date: toDate(r["거래일"], where),
        time: toTime(r["거래시각"], where),
        amount: inAmount - outAmount,
        description: text(outAmount > 0 ? r["출금표시내용"] : r["입금표시내용"]) || text(r["상대계좌명"]) || text(r["거래종류"]),
        method: text(r["거래종류"]) || null,
        memo: null,
        cardLabel: null,
        balanceAfter: toWon(r["잔액"], `${where} 잔액`),
        raw: r,
      });
    }
    // 계좌정보는 `계좌번호-상품번호 (이름)` 형식이다. 괄호 앞만 쓴다.
    const accountKey = labeledValue(info, 0, "계좌정보").replace(/\s*\(.*\)\s*$/, "");
    return finishFile({
      institution: "kis",
      accountKey,
      period: toPeriod(labeledValue(info, 2, "조회기간")),
      rows,
      order: "newest-first",
    });
  },
};
