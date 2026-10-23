// 탈퇴(4.1-6): 그 사용자 id로 남은 행이 없고 다른 사용자의 데이터는 그대로다. 전체 분류 횟수는 줄지 않는다.
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { deleteAccountAction } from "@/app/(app)/settings/actions";
import { reclassifyAction } from "@/app/(app)/actions";
import { saveKakaoPasswordAction } from "@/app/(app)/upload/actions";
import { classifyUsageTotal } from "@/db/schema";
import { SESSION_COOKIE } from "@/auth/session";
import { db, dbFingerprint, loginAs, newUser } from "./helpers";
import { seedUser } from "./fixtures";

const USER_TABLES = ["sessions", "accounts", "imports", "import_undo", "categories", "transactions", "category_rules", "settings", "upload_staging", "classify_usage"];

async function rowsOf(userId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of USER_TABLES) {
    const r = (await db().execute(sql.raw(`select count(*)::int as n from ${t} where user_id = ${userId}`))) as unknown as { rows: { n: number }[] };
    out[t] = r.rows[0].n;
  }
  const u = (await db().execute(sql.raw(`select count(*)::int as n from users where id = ${userId}`))) as unknown as { rows: { n: number }[] };
  out.users = u.rows[0].n;
  return out;
}

describe("탈퇴", () => {
  it("그 사용자의 모든 행이 지워지고 다른 사용자는 그대로다", async () => {
    const gone = await newUser("gone");
    const other = await newUser("other");
    await seedUser(gone);
    await seedUser(other);
    await loginAs(gone);
    await saveKakaoPasswordAction("가짜암호");
    await reclassifyAction(); // 분류 사용 기록을 남긴다(가짜 API)
    const totalBefore = await db().select().from(classifyUsageTotal);
    const otherBefore = await rowsOf(other);
    expect(Object.values(await rowsOf(gone)).some((n) => n > 0)).toBe(true);

    await expect(deleteAccountAction()).rejects.toMatchObject({ to: "/" });

    expect(Object.values(await rowsOf(gone)).every((n) => n === 0)).toBe(true);
    expect(await rowsOf(other)).toEqual(otherBefore);
    expect(await db().select().from(classifyUsageTotal)).toEqual(totalBefore);
    const jar = (globalThis as unknown as { testCookies: Map<string, string> }).testCookies;
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    // 지운 뒤의 지문이 그대로인지 한 번 더(남은 정리 작업이 없다)
    const after = await dbFingerprint();
    expect(await dbFingerprint()).toEqual(after);
  });
});
