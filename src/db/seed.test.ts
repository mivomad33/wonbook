import { describe, expect, it } from "vitest";
import { createTestContext, createTestUser } from "@/db/test-db";
import { asc, eq } from "drizzle-orm";
import { accounts, categories, imports, transactions } from "@/db/schema";
import { seed } from "@/db/seed";
import { getBalances } from "@/lib/balance";
import { listAdjustmentNotice } from "@/lib/balance/notice";
import { countOtherAiRules, countPending } from "@/lib/categorize";
import { getMonthlyReport } from "@/lib/reports";
import { listTransactions } from "@/lib/transactions";

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const all = { accountId: null, group: null, month: "all", categoryId: null, showDeleted: true } as const;

// 스키마나 lib/ 규칙이 바뀌어 시드가 깨지면 여기서 드러난다(design.md 4.5).
describe("확인용 시드", () => {
  it("여섯 달 치가 오류 없이 들어가고 손댄 거래와 이체가 있다", async () => {
    const { db, userId } = await createTestContext();
    // 한국 시간 2026-10-31 12:00
    await seed(db, userId, { now: new Date("2026-10-31T03:00:00Z") });
    expect(await db.select().from(accounts)).toHaveLength(4);

    const rows = await listTransactions(db, userId, all);
    // 달마다 업로드 16건, 이체 2건, 수동 1건 + 첫 달 비상금 적립 이체 2건 + 비상금 보정 1건
    // + 한 달에만 넣는 업로드 5건(석 달 전 야놀자, 지난달 크몽 정산·GS25·인터파크 티켓, 이번 달 인터파크 티켓 취소)
    expect(rows).toHaveLength(6 * 19 + 2 + 1 + 5);
    // 카카오 비상금의 실제 잔액이 1만 원 커서 첫 이자 날에 보정 거래가 생긴다(4단계 파일 7장).
    expect(rows.filter((r) => r.kind === "adjustment").map((r) => [r.accountName, r.date, r.amount])).toEqual([
      ["카카오 비상금", "2026-05-21", 10_000],
    ]);
    expect(await listAdjustmentNotice(db, userId)).toHaveLength(1);
    expect(rows.filter((r) => r.editedAt)).toHaveLength(1);
    expect(rows.filter((r) => r.deletedAt)).toHaveLength(1);
    // 업로드 거래는 계정마다 파일 하나로 넣어 업로드 기록이 남는다(3단계 파일 8.1).
    expect((await db.select().from(imports).orderBy(asc(imports.id))).map((r) => [r.fileName, r.periodStart, r.periodEnd, r.insertedCount])).toEqual([
      ["시드-하나 급여통장", "2026-05-01", "2026-10-31", 6 * 6 + 1],
      ["시드-하나카드", "2026-05-01", "2026-10-31", 6 * 8 + 4],
      ["시드-카카오 비상금", "2026-05-01", "2026-10-31", 6 * 2],
    ]);
    expect(new Set(rows.map((r) => r.date.slice(0, 7)))).toEqual(new Set(MONTHS));
    expect((await getBalances(db, userId)).size).toBe(3);

    // 카테고리(5단계 파일 9장): 업로드 거래는 저장된 분류로 붙고, 규칙이 없는 올리브영만 미분류다. 수동 거래는 user다.
    const categorized = await db
      .select({ description: transactions.description, kind: transactions.kind, source: transactions.categorySource, category: categories.name })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .orderBy(asc(transactions.id));
    const sources = (filter: (r: (typeof categorized)[number]) => boolean) => categorized.filter(filter).map((r) => r.source);
    expect(sources((r) => r.kind === "normal" && r.description !== "올리브영" && r.description !== "경조사 현금").every((s) => s === "saved")).toBe(true);
    expect(sources((r) => r.description === "올리브영")).toEqual(Array(6).fill(null));
    expect(sources((r) => r.description === "경조사 현금")).toEqual(Array(6).fill("user"));
    expect(categorized.filter((r) => r.kind !== "normal").every((r) => r.category === null)).toBe(true);
    expect(categorized.find((r) => r.description === "홍길동")?.category).toBe("육아·교육");
    expect(await countPending(db, userId)).toBe(6);
    // 별빛헤어는 AI가 기타 지출로 둔 셈이라 "기타 다시 분류" 대상이다(8장, 결정 F9).
    expect(categorized.filter((r) => r.description === "별빛헤어").map((r) => r.category)).toEqual(Array(6).fill("기타 지출"));
    expect(await countOtherAiRules(db, userId)).toBe(1);
  });

  // 6단계 확인용(6단계 파일 6장): 달을 바꾸면 숫자가 바뀌고, 이동 표·포인트 결제·환불만 있는 카테고리가 보인다.
  it("달마다 집계가 다르고 이동·포인트 결제·환불이 들어 있다", async () => {
    const { db, userId } = await createTestContext();
    // 한국 시간 2026-10-31 12:00
    await seed(db, userId, { now: new Date("2026-10-31T03:00:00Z") });
    const reports = await Promise.all(MONTHS.map((m) => getMonthlyReport(db, userId, m)));
    expect(new Set(reports.map((r) => r.account.expense)).size).toBe(6);
    expect(new Set(reports.map((r) => r.card.total)).size).toBe(6);
    // 6개월 각각에 수입·지출·카드 사용이 있다(design-refresh 명세서 4.7-1).
    for (const r of reports) {
      expect(r.account.income).toBeGreaterThan(0);
      expect(r.account.expense).toBeGreaterThan(0);
      expect(r.card.total).toBeGreaterThan(0);
    }
    expect(reports[4].account.incomeByCategory.map((l) => l.name)).toContain("부수입");
    const move = reports[0].account.moves.find((m) => m.name === "내 계좌·페이 이동");
    expect(move).toMatchObject({ inflow: 200_000, outflow: 200_000 });
    expect(reports[5].card.byCategory.find((l) => l.name === "여가·여행")).toMatchObject({ amount: -88_000, ratio: null });
    expect(reports[0].account.adjustments).toEqual({ count: 1, total: 10_000 });
    expect(reports[1].account.adjustments.count).toBe(0);
    const point = (await listTransactions(db, userId, all)).filter((r) => r.method === "포인트리");
    expect(point.map((r) => r.date)).toEqual(["2026-09-09"]);
  });

  it("월초에도 이번 달 카드 사용이 0보다 커서 6개월 모두 카드 막대가 보인다", async () => {
    for (const day of ["01", "02", "03"]) {
      const { db, userId } = await createTestContext();
      // 한국 시간 2026-10-<day> 12:00
      await seed(db, userId, { now: new Date(`2026-10-${day}T03:00:00Z`) });
      const report = await getMonthlyReport(db, userId, "2026-10");
      expect(report.card.total, day).toBeGreaterThan(0);
    }
  });

  it("이번 달 거래는 오늘까지만 넣는다", async () => {
    const { db, userId } = await createTestContext();
    await seed(db, userId, { now: new Date("2026-10-05T03:00:00Z") });
    const dates = (await listTransactions(db, userId, all)).map((r) => r.date);
    expect(dates.every((d) => d <= "2026-10-05")).toBe(true);
    expect(dates.some((d) => d.startsWith("2026-10"))).toBe(true);
  });

  it("계좌 식별값은 가짜 번호의 해시와 끝 4자리이고, 사용자마다 따로 넣을 수 있다", async () => {
    const { db, userId } = await createTestContext();
    const other = await createTestUser(db);
    await seed(db, userId, { now: new Date("2026-10-31T03:00:00Z") });
    await seed(db, other, { now: new Date("2026-10-31T03:00:00Z") });
    const rows = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.id));
    expect(rows.map((a) => a.externalKeyLast4)).toEqual(["0001", "0001", null, null]);
    expect(rows.every((a) => a.externalKeyHash == null || /^[0-9a-f]{64}$/.test(a.externalKeyHash))).toBe(true);
    expect(await listTransactions(db, other, all)).toHaveLength((await listTransactions(db, userId, all)).length);
  });
});
