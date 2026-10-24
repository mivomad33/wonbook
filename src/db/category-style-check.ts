// 마이그레이션 0002(카테고리 색·아이콘 채우기) 확인(design-refresh 명세서 4.9-2). 개수만 돌려주고 사용자 데이터는 내보내지 않는다.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { DEFAULT_CATEGORIES } from "./default-categories";

export type CategoryStyleCount = { total: number; mismatched: number };

/** 카테고리 수와, 처음 카테고리 이름인데 그 기본 색·아이콘이 아닌 카테고리 수. createdBefore 뒤에 만든 사용자의 카테고리는 뺀다. */
export async function countCategoryStyles(db: DbOrTx, createdBefore: Date): Promise<CategoryStyleCount> {
  const defaults = sql.join(
    DEFAULT_CATEGORIES.map((c) => sql`(${c.name}, ${c.color}, ${c.icon})`),
    sql`, `,
  );
  const r = (await db.execute(sql`
    select count(*)::int as total,
      count(*) filter (where d.name is not null and (c.color <> d.color or c.icon <> d.icon))::int as mismatched
    from categories c
    join users u on u.id = c.user_id
    left join (values ${defaults}) as d(name, color, icon) on d.name = c.name
    where u.created_at < ${createdBefore.toISOString()}
  `)) as unknown as { rows: CategoryStyleCount[] };
  return r.rows[0];
}

/** categories.color 칸이 있는지(0002가 이미 적용됐는지) */
export async function hasCategoryStyleColumns(db: DbOrTx): Promise<boolean> {
  const r = (await db.execute(sql`
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'categories' and column_name = 'color'
  `)) as unknown as { rows: unknown[] };
  return r.rows.length > 0;
}

/** DB 시각. 명령이 시작한 시각을 DB 시계로 잡는다. */
export async function dbNow(db: DbOrTx): Promise<Date> {
  const r = (await db.execute(sql`select now() as now`)) as unknown as { rows: { now: Date | string }[] };
  return new Date(r.rows[0].now);
}
