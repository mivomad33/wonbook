// 카테고리 조회·추가·수정·삭제(5단계 파일 8장). 분류 로직은 lib/categorize/에 둔다.
// 카테고리는 사용자별이다(2.3). 남의 카테고리 id는 없는 카테고리와 같다.
import { and, asc, eq, max, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { categories, type CategoryGroup, transactions } from "@/db/schema";
import { type CategoryInput, isFixedCategory } from "@/lib/category-form";
import { DEFAULT_CATEGORY_ICON, pickCategoryColor } from "@/lib/category-style";
import { UserError } from "@/lib/user-error";

// select 안의 컬럼은 테이블 이름 없이 렌더링돼 하위 쿼리에서 잘못 읽히므로 테이블 이름을 붙여 쓴다(design.md 2.3).
const outerCategoryId = sql.raw(`"categories"."id"`);

const groupOrder = sql`case ${categories.group} when 'expense' then 0 when 'income' then 1 else 2 end`;

// 묶음(지출 → 수입 → 이동) 안에서 sort_order 순. 화면의 선택 목록과 카테고리 화면이 같은 순서를 쓴다.
export async function listCategoryOptions(db: DbOrTx, userId: number) {
  return db
    .select({ id: categories.id, name: categories.name, group: categories.group, color: categories.color, icon: categories.icon })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(groupOrder, asc(categories.sortOrder), asc(categories.id));
}

// 카테고리 화면 목록. 거래 수는 삭제 표시하지 않은 거래(거래 목록에서 보이는 수), 저장된 분류 수는 category_rules 수다.
export async function listCategories(db: DbOrTx, userId: number) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      group: categories.group,
      color: categories.color,
      icon: categories.icon,
      transactionCount: sql<number>`(select count(*) from transactions t where t.category_id = ${outerCategoryId} and t.deleted_at is null)`.mapWith(Number),
      ruleCount: sql<number>`(select count(*) from category_rules r where r.category_id = ${outerCategoryId})`.mapWith(Number),
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(groupOrder, asc(categories.sortOrder), asc(categories.id));
}

function assertNotFixed(name: string) {
  if (isFixedCategory(name)) throw new UserError(`"${name}"은(는) AI 분류에 쓰는 카테고리라 바꾸거나 지울 수 없습니다.`);
}

export type CategoryListItem = Awaited<ReturnType<typeof listCategories>>[number];

export async function getCategory(db: DbOrTx, userId: number, id: number, field?: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)));
  if (!row) throw new UserError("카테고리를 찾을 수 없습니다. 이미 지워졌을 수 있습니다.", field);
  return row;
}

// unique index(user_id, coalesce(parent_id, 0), name)와 같은 조건을 미리 찾아 알려준다.
async function assertNameFree(db: DbOrTx, userId: number, name: string, excludeId?: number) {
  const [dup] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name), excludeId === undefined ? undefined : ne(categories.id, excludeId)))
    .limit(1);
  if (dup) throw new UserError(`"${name}" 카테고리가 이미 있습니다.`, "name");
}

// 같은 묶음의 맨 뒤 순서
async function nextSortOrder(db: DbOrTx, userId: number, group: CategoryGroup): Promise<number> {
  const [row] = await db
    .select({ max: max(categories.sortOrder) })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.group, group)));
  return row?.max == null ? 0 : row.max + 1;
}

// 색을 고르지 않았으면 묶음 안에서 가장 적게 쓴 색, 아이콘은 기본 아이콘을 준다(design-refresh 명세서 4.5-4).
async function autoColor(db: DbOrTx, userId: number, group: CategoryGroup) {
  const rows = await db
    .select({ color: categories.color })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.group, group)));
  return pickCategoryColor(group, rows.map((r) => r.color));
}

export async function createCategory(db: DbOrTx, userId: number, input: CategoryInput): Promise<number> {
  await assertNameFree(db, userId, input.name);
  const [row] = await db
    .insert(categories)
    .values({
      ...input,
      color: input.color ?? (await autoColor(db, userId, input.group)),
      icon: input.icon ?? DEFAULT_CATEGORY_ICON,
      userId,
      sortOrder: await nextSortOrder(db, userId, input.group),
    })
    .returning({ id: categories.id });
  return row.id;
}

// 이름·묶음·색·아이콘을 고친다. 묶음을 바꾸면 새 묶음의 맨 뒤로 간다.
// "기타" 카테고리는 이름·묶음은 못 바꾸지만 색·아이콘은 바꿀 수 있다. 색·아이콘을 비우면 그대로 둔다.
export async function updateCategory(db: DbOrTx, userId: number, id: number, input: CategoryInput): Promise<void> {
  const current = await getCategory(db, userId, id);
  if (current.name !== input.name || current.group !== input.group) assertNotFixed(current.name);
  await assertNameFree(db, userId, input.name, id);
  const sortOrder = current.group === input.group ? current.sortOrder : await nextSortOrder(db, userId, input.group);
  await db
    .update(categories)
    .set({ name: input.name, group: input.group, color: input.color ?? current.color, icon: input.icon ?? current.icon, sortOrder })
    .where(and(eq(categories.id, id), eq(categories.userId, userId)));
}

// 지우면 거래는 미분류(set null), 저장된 분류는 함께 지워진다(cascade).
// set null은 category_id만 비우므로 같은 트랜잭션에서 category_source도 비운다(미분류는 둘 다 null).
export async function deleteCategory(db: DbOrTx, userId: number, id: number): Promise<void> {
  assertNotFixed((await getCategory(db, userId, id)).name);
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId: null, categorySource: null })
      .where(and(eq(transactions.categoryId, id), eq(transactions.userId, userId)));
    await tx.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));
  });
}
