// 카테고리 색·아이콘(design-refresh 명세서 4.5)과 카드 계정별 사용액(4.2-3). 서버 동작은 화면과 같은 코드를 지난다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { saveCategoryAction } from "@/app/(app)/categories/actions";
import { countCategoryStyles, dbNow } from "@/db/category-style-check";
import { DEFAULT_CATEGORIES } from "@/db/default-categories";
import { accounts, categories, settings, transactions } from "@/db/schema";
import { SEED_VERSION } from "@/db/seed";
import { DEMO_READONLY_MESSAGE } from "@/auth/current";
import { ensureDemoUser } from "@/auth/demo";
import { AUTO_CATEGORY_COLORS, isCategoryColor, isCategoryIcon } from "@/lib/category-style";
import { getAssetOverview, getMonthlyReport } from "@/lib/reports";
import { asDemo, db, dbFingerprint, loginAs, newUser, rejected } from "./helpers";
import { categoryId, seedUser } from "./fixtures";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const styleOf = async (id: number) =>
  (await db().select({ color: categories.color, icon: categories.icon }).from(categories).where(eq(categories.id, id)))[0];

let a: number;
let b: number;
beforeAll(async () => {
  a = await newUser("style-a");
  b = await newUser("style-b");
});

describe("색·아이콘 저장(4.5-1, 4.5-6)", () => {
  it("목록 안의 색·아이콘으로 바꾸면 저장되고, 이름·묶음은 그대로 둘 수 있다", async () => {
    await loginAs(a);
    const id = await categoryId(a, "장보기");
    expect(await saveCategoryAction({}, form({ id: String(id), name: "장보기", group: "expense", color: "indigo", icon: "gift" }))).toEqual({ ok: true });
    expect(await styleOf(id)).toEqual({ color: "indigo", icon: "gift" });
  });

  it("\"기타\" 카테고리도 색·아이콘은 바꿀 수 있다(이름·묶음은 그대로)", async () => {
    await loginAs(a);
    const id = await categoryId(a, "기타 지출");
    expect(await saveCategoryAction({}, form({ id: String(id), name: "기타 지출", group: "expense", color: "brown", icon: "tag" }))).toEqual({ ok: true });
    expect(await styleOf(id)).toEqual({ color: "brown", icon: "tag" });
    expect(await rejected(() => saveCategoryAction({}, form({ id: String(id), name: "다른 이름", group: "expense" })))).toBe(true);
  });

  it.each([
    ["목록 밖 색", { color: "#ff0000" }, "color"],
    ["목록 밖 아이콘", { icon: "skull" }, "icon"],
  ])("%s은 거부되고 DB가 그대로다", async (_n, extra, field) => {
    await loginAs(a);
    const id = await categoryId(a, "외식·배달");
    const before = await dbFingerprint();
    const r = await saveCategoryAction({}, form({ id: String(id), name: "외식·배달", group: "expense", ...extra }));
    expect(r).toHaveProperty(["fieldErrors", field]);
    expect(await dbFingerprint()).toEqual(before);
    // 새로 만들 때도 같다.
    expect(await saveCategoryAction({}, form({ name: "가짜 새 카테고리", group: "expense", ...extra }))).toHaveProperty(["fieldErrors", field]);
    expect(await dbFingerprint()).toEqual(before);
  });

  it("다른 사용자의 카테고리 색·아이콘은 바꿀 수 없다", async () => {
    await loginAs(b);
    const id = await categoryId(a, "통신");
    const before = await styleOf(id);
    expect(await rejected(() => saveCategoryAction({}, form({ id: String(id), name: "통신", group: "expense", color: "red", icon: "fuel" })), "카테고리를 찾을 수 없습니다")).toBe(true);
    expect(await styleOf(id)).toEqual(before);
  });

  it("데모는 색·아이콘을 바꿀 수 없다", async () => {
    await ensureDemoUser(db()); // 데모 데이터는 처음 열 때 만들어지므로 지문을 뜨기 전에 만든다
    asDemo();
    const id = await categoryId(a, "통신");
    const before = await dbFingerprint();
    expect(await rejected(() => saveCategoryAction({}, form({ id: String(id), name: "통신", group: "expense", color: "red" })), DEMO_READONLY_MESSAGE)).toBe(true);
    expect(await dbFingerprint()).toEqual(before);
  });
});

describe("새 카테고리의 색(4.5-4)", () => {
  it("색을 고르지 않으면 그 묶음에서 가장 적게 쓴 색 중 하나이고 아이콘은 기본(태그)이다", async () => {
    const u = await newUser("style-new");
    await loginAs(u);
    for (let i = 1; i <= 14; i++) {
      // 묶음 안 색 사용 수를 세어 두고 새로 만든다.
      const used = await db()
        .select({ color: categories.color, n: sql<number>`count(*)::int` })
        .from(categories)
        .where(and(eq(categories.userId, u), eq(categories.group, "expense")))
        .groupBy(categories.color);
      const count = (c: string) => used.find((r) => r.color === c)?.n ?? 0;
      const least = Math.min(...AUTO_CATEGORY_COLORS.map(count));
      expect(await saveCategoryAction({}, form({ name: `가짜 지출 ${i}`, group: "expense" }))).toEqual({ ok: true });
      const created = await styleOf(await categoryId(u, `가짜 지출 ${i}`));
      expect(created.icon).toBe("tag");
      expect(AUTO_CATEGORY_COLORS).toContain(created.color);
      expect(count(created.color)).toBe(least);
    }
    // 이동 묶음은 회색이다.
    expect(await saveCategoryAction({}, form({ name: "가짜 이동", group: "move" }))).toEqual({ ok: true });
    expect((await styleOf(await categoryId(u, "가짜 이동"))).color).toBe("gray");
  });

  it("만드는 대화상자에서 고른 색·아이콘은 그대로 저장된다", async () => {
    await loginAs(a);
    expect(await saveCategoryAction({}, form({ name: "가짜 운동", group: "expense", color: "pink", icon: "dumbbell" }))).toEqual({ ok: true });
    expect(await styleOf(await categoryId(a, "가짜 운동"))).toEqual({ color: "pink", icon: "dumbbell" });
  });
});

describe("마이그레이션 0002 채우기(4.5-3, 4.9-2)", () => {
  it("빈 값이 없고, 처음 카테고리 이름은 기본값, 그 밖의 지출·수입은 팔레트를 돌린 색과 태그, 이동은 회색이다", async () => {
    const u = await newUser("style-migrate");
    const custom = ["가짜 A", "가짜 B", "가짜 C"];
    await db()
      .insert(categories)
      .values([
        ...custom.map((name, i) => ({ userId: u, name, group: "income" as const, sortOrder: 100 + i })),
        { userId: u, name: "가짜 이동", group: "move" as const, sortOrder: 100 },
      ]);
    // 마이그레이션 전 상태: 새 칸의 DB 기본값(회색·태그)
    await db().update(categories).set({ color: "gray", icon: "tag" }).where(eq(categories.userId, u));
    const startedAt = await dbNow(db());

    // 0002의 채우기 문장(칸 더하기 뒤)을 그대로 실행한다.
    const file = readFileSync(path.join(process.cwd(), "drizzle/0002_category_style.sql"), "utf8");
    const updates = file.split("--> statement-breakpoint").filter((s) => /UPDATE/.test(s));
    expect(updates).toHaveLength(2);
    for (const stmt of updates) await db().execute(sql.raw(stmt));

    const rows = await db().select().from(categories).where(eq(categories.userId, u));
    for (const r of rows) {
      expect(isCategoryColor(r.color)).toBe(true);
      expect(isCategoryIcon(r.icon)).toBe(true);
    }
    for (const d of DEFAULT_CATEGORIES) {
      const r = rows.find((x) => x.name === d.name)!;
      expect({ name: r.name, color: r.color, icon: r.icon }).toEqual({ name: d.name, color: d.color, icon: d.icon });
    }
    const customRows = rows.filter((r) => custom.includes(r.name)).sort((x, y) => x.sortOrder - y.sortOrder);
    // 수입 묶음에서 처음 카테고리가 아닌 것은 이 셋뿐이라 팔레트 처음부터 돈다.
    expect(customRows.map((r) => [r.color, r.icon])).toEqual([
      ["green", "tag"],
      ["teal", "tag"],
      ["sky", "tag"],
    ]);
    expect(rows.find((r) => r.name === "가짜 이동")!.color).toBe("gray");

    // 확인 조회: 처음 카테고리 이름인데 기본값이 아닌 것이 없고, 시작 뒤에 만든 사용자는 뺀다.
    const later = await newUser("style-later");
    await db().update(categories).set({ color: "red" }).where(and(eq(categories.userId, later), eq(categories.name, "장보기")));
    const count = await countCategoryStyles(db(), startedAt);
    expect(count.total).toBeGreaterThanOrEqual(rows.length);
    // 앞 테스트가 바꾼 사용자(a)의 카테고리도 채우기 문장이 기본값으로 되돌렸으므로 0이다.
    expect(count.mismatched).toBe(0);
    // 시작 뒤에 만든 사용자를 세면 1이 된다.
    expect((await countCategoryStyles(db(), new Date(Date.now() + 60_000))).mismatched).toBe(1);
  });
});

describe("카드 계정별 이번 달 사용액(4.2-3)", () => {
  it("카드 두 개의 사용액 합이 월별 집계의 카드 사용과 같고, 계정마다 손으로 센 값과 같다", async () => {
    const u = await newUser("style-cards");
    const month = new Date().toISOString().slice(0, 7);
    const [c1, c2, bank] = await db()
      .insert(accounts)
      .values([
        { userId: u, name: "가짜 카드 1", kind: "card" },
        { userId: u, name: "가짜 카드 2", kind: "card" },
        { userId: u, name: "가짜 통장", kind: "asset" },
      ])
      .returning({ id: accounts.id });
    const tx = (accountId: number, amount: number, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
      userId: u,
      accountId,
      amount,
      kind: "normal" as const,
      source: "upload" as const,
      date: `${month}-01`,
      ...extra,
    });
    await db()
      .insert(transactions)
      .values([
        tx(c1.id, -30_000),
        tx(c1.id, -12_500),
        tx(c1.id, 2_500), // 환불
        tx(c1.id, -99_000, { deletedAt: new Date().toISOString() }),
        tx(c2.id, -7_000),
        tx(c2.id, -1_000, { date: "2001-01-01" }), // 다른 달
        tx(bank.id, -50_000),
      ]);
    const overview = await getAssetOverview(db(), u, month);
    const usage = new Map(overview.cards.map((c) => [c.id, c.monthUsage]));
    expect(usage.get(c1.id)).toBe(40_000);
    expect(usage.get(c2.id)).toBe(7_000);
    const { card } = await getMonthlyReport(db(), u, month);
    expect([...usage.values()].reduce((s, v) => s + v, 0)).toBe(card.total);
    // 손으로 센 값: 계정마다 그 달의 지워지지 않은 일반 거래 합의 부호를 뒤집은 값
    for (const c of [c1, c2]) {
      const rows = await db()
        .select({ amount: transactions.amount, date: transactions.date, deletedAt: transactions.deletedAt })
        .from(transactions)
        .where(inArray(transactions.accountId, [c.id]));
      const manual = -rows.filter((r) => r.date.startsWith(month) && !r.deletedAt).reduce((s, r) => s + r.amount, 0);
      expect(usage.get(c.id)).toBe(manual);
    }
  });
});

describe("데모 다시 만들기(4.7-2)", () => {
  it("저장된 시드 버전이 지금과 다르면(예전 값) 데모 데이터를 다시 만들고, 다른 사용자의 행은 그대로다", async () => {
    const other = await newUser("style-demo-other");
    await seedUser(other);
    const demo = await ensureDemoUser(db());
    const demoAccounts = async () => (await db().select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, demo.id))).map((r) => r.id);
    const before = await demoAccounts();
    // 같은 버전이면 다시 만들지 않는다.
    await ensureDemoUser(db());
    expect(await demoAccounts()).toEqual(before);

    // 이번 배포 전의 저장 값("YYYY-MM", 버전 없음)으로 되돌린다.
    await db()
      .update(settings)
      .set({ value: new Date().toISOString().slice(0, 7) })
      .where(and(eq(settings.userId, demo.id), eq(settings.key, "demo_seeded_month")));
    const othersBefore = await rowsOfOthers(demo.id);
    await ensureDemoUser(db());
    const after = await demoAccounts();
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect(after).toHaveLength(before.length);
    const [saved] = await db().select({ value: settings.value }).from(settings).where(and(eq(settings.userId, demo.id), eq(settings.key, "demo_seeded_month")));
    expect(saved.value).toMatch(new RegExp(`#v${SEED_VERSION}$`));
    // 새 시드는 6개월이고 카테고리 색이 기본값이다.
    const months = await db().selectDistinct({ m: sql<string>`left(${transactions.date}, 7)` }).from(transactions).where(eq(transactions.userId, demo.id));
    expect(months.length).toBeGreaterThanOrEqual(6);
    expect((await styleOf(await categoryId(demo.id, "장보기")))).toEqual({ color: "green", icon: "shopping-cart" });
    expect(await rowsOfOthers(demo.id)).toEqual(othersBefore);
  });
});

// 데모가 아닌 사용자의 가계부 행 지문
async function rowsOfOthers(demoId: number) {
  const out: Record<string, string> = {};
  for (const t of ["accounts", "transactions", "categories", "category_rules", "settings", "imports"]) {
    const r = (await db().execute(
      sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' order by t::text)), '') as f from ${t} t where user_id <> ${demoId}`),
    )) as unknown as { rows: { f: string }[] };
    out[t] = r.rows[0].f;
  }
  return out;
}
