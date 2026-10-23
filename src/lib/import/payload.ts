// 브라우저가 서버로 보내는 업로드 값(4.3-1). 파일은 브라우저에서 읽고, 서버로는 읽은 결과만 보낸다.
// 계좌번호는 해시와 끝 4자리로, 거래 내용·메모·파일 이름의 긴 숫자는 가려서 보낸다(2.2). 거래 원본 행(raw)은 보내지 않는다.
// 브라우저에서 불러 쓰므로 node: 모듈과 DB 코드를 두지 않는다.
import type { Institution } from "@/db/schema";
import type { ParsedFile, ParsedTransaction } from "@/lib/parsers";
import { type AccountKeyRef, toAccountKeyRef } from "@/lib/privacy/account-key";
import { maskAccountNumbers } from "@/lib/privacy/mask";

export type UploadedTransaction = Omit<ParsedTransaction, "raw">;

export type UploadedFile = {
  // 가린 파일 이름
  fileName: string;
  institution: Institution;
  // 계좌 식별값(키 없는 해시와 끝 4자리). 카드사는 null이다.
  accountKey: AccountKeyRef | null;
  // 덮어쓸 기간(3단계 파일 2장)
  period: { start: string; end: string };
  // 오래된 순. 기초 잔액(openingFromFile)은 이 목록의 첫 거래와 기간에서 계산한다.
  transactions: UploadedTransaction[];
};

// 서버 동작이 받는 파일 하나. 업로드 흐름의 확인 값을 함께 보낸다(3단계 파일 5.1·5.2).
export type UploadRequestFile = UploadedFile & {
  // 사용자가 확인한 손댄 거래 id. 처음 올릴 때는 비어 있다.
  confirmedIds: number[];
  // "계정 만들고 올리기"(3단계 파일 3장, 결정 D5): 맞는 계정이 없으면 만들어 반영한다.
  createAccount?: boolean;
};

// 거래 하나의 글 칸을 가린다. 서버도 받은 값에 같은 함수를 다시 쓴다(가린 값을 다시 가려도 같다).
export function maskTransaction(t: UploadedTransaction): UploadedTransaction {
  return {
    date: t.date,
    time: t.time,
    amount: t.amount,
    description: maskAccountNumbers(t.description),
    method: maskAccountNumbers(t.method),
    memo: maskAccountNumbers(t.memo),
    cardLabel: maskAccountNumbers(t.cardLabel),
    balanceAfter: t.balanceAfter,
  };
}

// 파서 결과를 보낼 값으로 바꾼다(브라우저).
export async function toUploadedFile(name: string, parsed: ParsedFile): Promise<UploadedFile> {
  return {
    fileName: maskAccountNumbers(name),
    institution: parsed.institution,
    accountKey: await toAccountKeyRef(parsed.institution, parsed.accountKey),
    period: { start: parsed.period.start, end: parsed.period.end },
    transactions: parsed.transactions.map(maskTransaction),
  };
}
