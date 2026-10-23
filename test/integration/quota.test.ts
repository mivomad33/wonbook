// 분류 한도(4.4-2)를 실제 Postgres에서 동시 요청으로 확인한다. Claude API는 가짜다.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { accounts, classifyUsage, classifyUsageTotal, transactions } from "@/db/schema";
import { applyImport, type UploadedTransaction } from "@/lib/import";
import { type Classifier, classifyPending } from "@/lib/categorize";
import { reserve } from "@/lib/categorize/quota";
import { db, newAdmin, newUser } from "./helpers";

// 날마다 새 한도를 쓰도록 테스트마다 다른 날(한국 시간)을 쓴다.
let dayOffset = 0;
const nextDay = () => new Date(Date.UTC(2030, 0, 1 + dayOffset++, 3));

const shops = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
const row = (description: string): UploadedTransaction => ({ date: "2026-10-10", time: null, amount: -1_000, description, method: null, memo: null, cardLabel: null, balanceAfter: null });

async function uploadShops(userId: number, names: string[]) {
  const [{ id }] = await db().insert(accounts).values({ userId, name: "카드", kind: "card", institution: "hana_card" }).returning();
  const r = await applyImport(db(), userId, { accountId: id, fileName: "가짜.xlsx", file: { institution: "hana_card", period: { start: "2026-10-01", end: "2026-10-31" }, transactions: names.map(row) }, confirmedIds: [] });
  if (r.status !== "applied") throw new Error("업로드 실패");
}

const sent: string[] = [];
const fake: Classifier = async (items) => {
  sent.push(...items.map((i) => i.description ?? ""));
  await new Promise((r) => setTimeout(r, 20));
  return new Map(items.map((i) => [i.id, "기타 지출"]));
};
const pendingCount = async (userId: number) =>
  (await db().select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), isNull(transactions.categoryId)))).length;

beforeEach(() => {
  sent.length = 0;
  process.env.CLASSIFY_USER_DAILY_LIMIT = "30";
  process.env.CLASSIFY_TOTAL_DAILY_LIMIT = "50";
});
afterEach(() => {
  delete process.env.CLASSIFY_USER_DAILY_LIMIT;
  delete process.env.CLASSIFY_TOTAL_DAILY_LIMIT;
});

describe("분류 한도(실제 Postgres)", () => {
  it("동시에 예약해도 사용자 한도와 전체 한도를 넘지 않는다", async () => {
    const now = nextDay();
    const u1 = await newUser();
    const u2 = await newUser();
    const grants = await Promise.all([
      ...Array.from({ length: 10 }, () => reserve(db(), { userId: u1, isAdmin: false, want: 7, now })),
      ...Array.from({ length: 10 }, () => reserve(db(), { userId: u2, isAdmin: false, want: 7, now })),
    ]);
    const u1Sum = grants.slice(0, 10).reduce((s, n) => s + n, 0);
    const u2Sum = grants.slice(10).reduce((s, n) => s + n, 0);
    expect(u1Sum).toBeLessThanOrEqual(30);
    expect(u2Sum).toBeLessThanOrEqual(30);
    expect(u1Sum + u2Sum).toBe(50);
    const day = (await db().select().from(classifyUsageTotal)).find((r) => r.count === 50);
    expect(day).toBeTruthy();
  });

  it("동시에 분류해도 한도를 넘는 키는 API에 가지 않고 미분류로 남는다", async () => {
    const now = nextDay();
    const u = await newUser();
    await uploadShops(u, shops("가짜상점", 60));
    // 같은 사용자가 두 화면에서 동시에 다시 분류를 누른 경우
    const results = await Promise.all([1, 2, 3].map(() => classifyPending(db(), u, { classify: fake, quota: { userId: u, isAdmin: false }, now })));
    expect(new Set(sent).size).toBeLessThanOrEqual(30);
    expect(results.some((r) => r.limited)).toBe(true);
    expect(await pendingCount(u)).toBe(60 - new Set(sent).size);
    const [usage] = await db().select().from(classifyUsage).where(eq(classifyUsage.userId, u));
    expect(usage.count).toBeLessThanOrEqual(30);
  });

  it("관리자는 한도에 걸리지 않고 전체 횟수가 늘지 않는다", async () => {
    const now = nextDay();
    const admin = await newAdmin();
    await uploadShops(admin, shops("관리자상점", 60));
    const r = await classifyPending(db(), admin, { classify: fake, quota: { userId: admin, isAdmin: true }, now });
    expect(r.limited).toBe(false);
    expect(new Set(sent).size).toBe(60);
    const totals = await db().select().from(classifyUsageTotal);
    const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
    expect(totals.find((t) => t.day === dayKey)?.count ?? 0).toBe(0);
  });
});
