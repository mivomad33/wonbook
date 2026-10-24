import { describe, expect, it } from "vitest";
import { createTestContext, createTestUser } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createAccount } from "@/lib/accounts";
import { csvCell, CSV_HEADER, exportTransactionsCsv } from "@/lib/export";
import { createTransaction, listTransactions } from "@/lib/transactions";

const NOW = new Date("2026-10-31T03:00:00Z");
const all = { accountId: null, group: null, month: "all", categoryId: null, showDeleted: true } as const;

// 따옴표 안의 쉼표·줄바꿈을 지키며 줄과 칸으로 나눈다(테스트용 간단한 CSV 읽기).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += c;
    }
  }
  return rows;
}

describe("거래 CSV 내보내기(4.2-5)", () => {
  it("UTF-8 BOM으로 시작하고, 행 수가 그 사용자의 거래 수와 같으며 다른 사용자의 거래가 없다", async () => {
    const { db, userId: a } = await createTestContext();
    const b = await createTestUser(db);
    await seed(db, a, { now: NOW });
    const wallet = await createAccount(db, b, { name: "B 지갑", kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null });
    await createTransaction(db, b, { accountId: wallet, date: "2026-10-01", time: null, amount: -500, description: "B만의 거래", memo: null });

    const csv = await exportTransactionsCsv(db, a);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, ...rows] = parseCsv(csv.slice(1));
    expect(header).toEqual([...CSV_HEADER]);
    expect(rows).toHaveLength((await listTransactions(db, a, all)).length);
    expect(csv).not.toContain("B만의 거래");
    expect(csv).not.toContain("B 지갑");
    // 구분과 삭제 표시
    expect(new Set(rows.map((r) => r[8]))).toEqual(new Set(["일반", "이체", "보정"]));
    expect(rows.filter((r) => r[9] === "삭제")).toHaveLength(1);
    // 카테고리와 금액
    expect(rows.find((r) => r[4] === "경조사 현금")).toEqual(["하나 급여통장", "2026-05-14", "", "-20000", "경조사 현금", "", "직접 입력", "경조사·기부", "일반", ""]);

    const other = parseCsv((await exportTransactionsCsv(db, b)).slice(1));
    expect(other).toEqual([[...CSV_HEADER], ["B 지갑", "2026-10-01", "", "-500", "B만의 거래", "", "", "", "일반", ""]]);
  });

  it("쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싼다", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(-1200)).toBe("-1200");
  });
});
