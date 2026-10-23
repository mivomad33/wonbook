// 거래 CSV 내보내기(4.2-5). 탈퇴 전에 자기 거래를 챙길 수 있게 그 사용자의 거래 전체를 내보낸다.
// 엑셀에서 한글이 깨지지 않게 UTF-8 BOM으로 시작하고, 줄바꿈은 CRLF다.
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, categories, transactions } from "@/db/schema";
import { TRANSACTION_KIND_LABELS } from "@/lib/labels";
import { ascNullsFirst } from "@/lib/sql";

export const CSV_HEADER = ["계정", "날짜", "시각", "금액", "내용", "거래 방식", "메모", "카테고리", "구분", "삭제 표시"] as const;

// 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싸고, 안의 따옴표는 두 번 쓴다(RFC 4180).
export function csvCell(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 오래된 거래가 위다. 같은 날은 시각, 파일 순서(seq), 넣은 순서로 둔다.
export async function exportTransactionsCsv(db: DbOrTx, userId: number): Promise<string> {
  const rows = await db
    .select({
      account: accounts.name,
      date: transactions.date,
      time: transactions.time,
      amount: transactions.amount,
      description: transactions.description,
      method: transactions.method,
      memo: transactions.memo,
      category: categories.name,
      kind: transactions.kind,
      deletedAt: transactions.deletedAt,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.date), ascNullsFirst(transactions.time), ascNullsFirst(transactions.seq), asc(transactions.id));
  const lines = [
    CSV_HEADER.join(","),
    ...rows.map((r) =>
      [
        r.account,
        r.date,
        r.time,
        r.amount,
        r.description,
        r.method,
        r.memo,
        r.category,
        TRANSACTION_KIND_LABELS[r.kind],
        r.deletedAt ? "삭제" : "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
