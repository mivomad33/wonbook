// 이전 결과 비교(4.8-3). 이전한 원격 DB의 관리자 데이터로 계산한 값이 이전 직전 로컬 DB로 계산한 값과 같은지 본다.
// - 앱 계산(자산 현황, 최근 세 달 월별 수입/지출): 로컬 DB를 가리기·해시 없이 그대로 옮긴 프로세스 안 Postgres(PGlite)를 기준으로,
//   같은 앱 코드로 계산해 견준다. 같은 시각(now) 기준이다.
// - 원본 직접 계산: 로컬 SQLite를 SQL로 바로 읽은 값(계정별 거래 수·미분류 수·삭제 표시 수·금액 합, 카테고리별 금액 합)과 견준다.
//   이전 코드를 거치지 않으므로 이전 코드가 칸을 빠뜨린 경우도 잡는다.
// 결과에는 항목 이름과 통과 여부만 담는다(금액·이름을 출력하지 않는다).
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { currentMonth, shiftMonth } from "@/lib/format";
import { getAssetOverview, getMonthlyReport } from "@/lib/reports";
import { importLocal, type LocalDb } from "./import-local";

export type Check = { name: string; ok: boolean };

// id는 DB마다 다르므로 빼고 견준다(계정·카테고리는 이름으로 맞춰진다).
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["id", "categoryId", "accountId"].includes(k))
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(withoutIds(a)) === JSON.stringify(withoutIds(b));

async function appFigures(db: Db, userId: number, now: Date) {
  const month = currentMonth(now);
  const months = [month, shiftMonth(month, -1), shiftMonth(month, -2)];
  return {
    overview: await getAssetOverview(db, userId),
    monthly: await Promise.all(months.map(async (m) => [m, await getMonthlyReport(db, userId, m)] as const)),
  };
}

type Row = Record<string, string | number | null>;
const sorted = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.values(r).map((v) => (v == null ? null : String(v))))).sort();

// 같은 질의를 SQLite와 Postgres에서 돌린다. 이름 칸으로 묶어 id에 기대지 않는다.
const ACCOUNT_SQL = (where: string) => `
  select a.name, a.kind, a.opening_balance, a.opening_date,
    count(t.id) as tx_count,
    sum(case when t.id is not null and t.category_id is null and t.deleted_at is null and t.kind = 'normal' then 1 else 0 end) as uncategorized,
    sum(case when t.deleted_at is not null then 1 else 0 end) as deleted,
    coalesce(sum(case when t.deleted_at is null then t.amount else 0 end), 0) as amount_sum
  from accounts a left join transactions t on t.account_id = a.id
  ${where}
  group by a.id, a.name, a.kind, a.opening_balance, a.opening_date`;
const CATEGORY_SQL = (where: string) => `
  select coalesce(p.name, '') as parent, c.name, c."group", count(t.id) as tx_count, coalesce(sum(t.amount), 0) as amount_sum
  from categories c left join categories p on p.id = c.parent_id left join transactions t on t.category_id = c.id
  ${where}
  group by c.id, p.name, c.name, c."group"`;
const OTHER_SQL = (where: string) => `
  select (select count(*) from category_rules r ${where.replace("ALIAS", "r")}) as rules,
    (select count(*) from imports i ${where.replace("ALIAS", "i")}) as imports,
    (select count(*) from transactions t ${where.replace("ALIAS", "t")} ${where ? "and" : "where"} t.transfer_peer_id is not null) as linked`;

async function pgRows(db: Db, query: string): Promise<Row[]> {
  return ((await db.execute(sql.raw(query))) as unknown as { rows: Row[] }).rows;
}

export async function compareImport(target: Db, userId: number, local: LocalDb, now: Date): Promise<Check[]> {
  const baseline = await createTestDb();
  const base = await importLocal(baseline, local, { email: "baseline@local.invalid", verbatim: true });
  const mine = await appFigures(target, userId, now);
  const expected = await appFigures(baseline, base.userId, now);

  const checks: Check[] = [{ name: "자산 현황(계정별 잔액, 자산·부채 합계, 순자산)", ok: same(mine.overview, expected.overview) }];
  for (const [i, [m, report]] of mine.monthly.entries()) {
    checks.push({ name: `월별 수입/지출 ${m}(합계와 카테고리별 금액)`, ok: same(report, expected.monthly[i][1]) });
  }
  const sqlite = (q: string) => local.prepare(q).all() as Row[];
  const uid = Number(userId);
  checks.push({
    name: "계정별 거래 수·미분류 수·삭제 표시 수·금액 합(원본 직접 계산)",
    ok: JSON.stringify(sorted(sqlite(ACCOUNT_SQL("")))) === JSON.stringify(sorted(await pgRows(target, ACCOUNT_SQL(`where a.user_id = ${uid}`)))),
  });
  checks.push({
    name: "카테고리별 거래 수·금액 합(원본 직접 계산)",
    ok: JSON.stringify(sorted(sqlite(CATEGORY_SQL("")))) === JSON.stringify(sorted(await pgRows(target, CATEGORY_SQL(`where c.user_id = ${uid}`)))),
  });
  checks.push({
    name: "저장된 분류·업로드 기록·이체 연결 수(원본 직접 계산)",
    ok: JSON.stringify(sorted(sqlite(OTHER_SQL("")))) === JSON.stringify(sorted(await pgRows(target, OTHER_SQL(`where ALIAS.user_id = ${uid}`)))),
  });
  return checks;
}
