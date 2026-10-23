// 분류 한도(4.4-2). Claude API에 보내는 키 수로 센다. 사용자별 하루 한도와 전체 하루 한도가 있고, 하루는 한국 시간 기준이다.
// 관리자는 두 한도 모두에서 빠지고 전체 횟수에도 넣지 않는다.
import { and, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { classifyUsage, classifyUsageTotal } from "@/db/schema";
import { today } from "@/lib/format";

export const DEFAULT_USER_DAILY_LIMIT = 500;
export const DEFAULT_TOTAL_DAILY_LIMIT = 3000;

// 환경 변수로 바꿀 수 있다. 잘못된 값이면 기본값을 쓴다. 테스트가 바꿀 수 있게 부를 때마다 읽는다.
export function classifyLimits(): { userDaily: number; totalDaily: number } {
  const read = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return process.env[name] && Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return {
    userDaily: read("CLASSIFY_USER_DAILY_LIMIT", DEFAULT_USER_DAILY_LIMIT),
    totalDaily: read("CLASSIFY_TOTAL_DAILY_LIMIT", DEFAULT_TOTAL_DAILY_LIMIT),
  };
}

// 한도를 세는 주인. 분류를 부르는 서버 동작이 세션 사용자로 만든다.
export type QuotaOwner = { userId: number; isAdmin: boolean };

// 키를 want개까지 예약하고 받은 수를 돌려준다. 사용자 남은 수와 전체 남은 수 중 작은 만큼만 준다.
// 두 날짜 행을 만든 뒤 한 트랜잭션에서 잠가(FOR UPDATE) 읽고 늘리므로, 동시에 불러도 한도를 넘지 않는다.
// 잠그는 순서(전체 → 사용자)를 늘 같게 해 교착을 피한다.
export async function reserve(db: DbOrTx, args: QuotaOwner & { want: number; now?: Date }): Promise<number> {
  const { userId, isAdmin, want } = args;
  if (want <= 0) return 0;
  if (isAdmin) return want;
  const day = today(args.now);
  const limits = classifyLimits();
  return db.transaction(async (tx) => {
    await tx.insert(classifyUsageTotal).values({ day, count: 0 }).onConflictDoNothing();
    await tx.insert(classifyUsage).values({ userId, day, count: 0 }).onConflictDoNothing();
    const [total] = await tx.select().from(classifyUsageTotal).where(eq(classifyUsageTotal.day, day)).for("update");
    const [mine] = await tx
      .select()
      .from(classifyUsage)
      .where(and(eq(classifyUsage.userId, userId), eq(classifyUsage.day, day)))
      .for("update");
    const granted = Math.max(0, Math.min(want, limits.userDaily - mine.count, limits.totalDaily - total.count));
    if (granted > 0) {
      await tx
        .update(classifyUsageTotal)
        .set({ count: sql`${classifyUsageTotal.count} + ${granted}` })
        .where(eq(classifyUsageTotal.day, day));
      await tx
        .update(classifyUsage)
        .set({ count: sql`${classifyUsage.count} + ${granted}` })
        .where(and(eq(classifyUsage.userId, userId), eq(classifyUsage.day, day)));
    }
    return granted;
  });
}

// API 호출이 실패한 키를 돌려준다. now는 예약할 때와 같은 값을 넘긴다(자정을 넘겨도 예약한 날에서 뺀다).
export async function refund(db: DbOrTx, args: QuotaOwner & { now?: Date }, n: number): Promise<void> {
  if (n <= 0 || args.isAdmin) return;
  const day = today(args.now);
  await db.transaction(async (tx) => {
    await tx
      .update(classifyUsageTotal)
      .set({ count: sql`greatest(${classifyUsageTotal.count} - ${n}, 0)` })
      .where(eq(classifyUsageTotal.day, day));
    await tx
      .update(classifyUsage)
      .set({ count: sql`greatest(${classifyUsage.count} - ${n}, 0)` })
      .where(and(eq(classifyUsage.userId, args.userId), eq(classifyUsage.day, day)));
  });
}

// 관리자 화면의 오늘 분류 사용량(2.2). 사용자 id와 횟수만 돌려준다(이메일·가계부 데이터 없음).
export async function todayUsage(db: DbOrTx, now?: Date): Promise<{ total: number; totalLimit: number; perUser: { userId: number; count: number }[] }> {
  const day = today(now);
  const [total] = await db.select({ count: classifyUsageTotal.count }).from(classifyUsageTotal).where(eq(classifyUsageTotal.day, day));
  const perUser = await db
    .select({ userId: classifyUsage.userId, count: classifyUsage.count })
    .from(classifyUsage)
    .where(eq(classifyUsage.day, day))
    .orderBy(desc(classifyUsage.count), classifyUsage.userId);
  return { total: total?.count ?? 0, totalLimit: classifyLimits().totalDaily, perUser: perUser.filter((r) => r.count > 0) };
}
