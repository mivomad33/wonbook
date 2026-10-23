// 카테고리 조회·추가·수정·삭제(5단계 파일 8장). 분류 로직은 lib/categorize/에 둔다.
import { and, asc, eq, max, ne, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { categories, type CategoryGroup, transactions } from "@/db/schema";
import { type CategoryInput, isFixedCategory } from "@/lib/category-form";
import { UserError } from "@/lib/user-error";

// select 안의 컬럼은 테이블 이름 없이 렌더링돼 하위 쿼리에서 잘못 읽히므로 테이블 이름을 붙여 쓴다(design.md 2.3).
const outerCategoryId = sql.raw(`"categories"."id"`);

const groupOrder = sql`case ${categories.group} when 'expense' then 0 when 'income' then 1 else 2 end`;

// 묶음(지출 → 수입 → 이동) 안에서 sort_order 순. 화면의 선택 목록과 카테고리 화면이 같은 순서를 쓴다.
export function listCategoryOptions(db: DbOrTx) {
  return db
    .select({ id: categories.id, name: categories.name, group: categories.group })
    .from(categories)
    .orderBy(groupOrder, asc(categories.sortOrder), asc(categories.id))
    .all();
}

// 카테고리 화면 목록. 거래 수는 삭제 표시하지 않은 거래(거래 목록에서 보이는 수), 저장된 분류 수는 category_rules 수다.
export function listCategories(db: Db) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      group: categories.group,
      transactionCount: sql<number>`(select count(*) from transactions t where t.category_id = ${outerCategoryId} and t.deleted_at is null)`,
      ruleCount: sql<number>`(select count(*) from category_rules r where r.category_id = ${outerCategoryId})`,
    })
    .from(categories)
    .orderBy(groupOrder, asc(categories.sortOrder), asc(categories.id))
    .all();
}

function assertNotFixed(name: string) {
  if (isFixedCategory(name)) throw new UserError(`"${name}"은(는) AI 분류에 쓰는 카테고리라 바꾸거나 지울 수 없습니다.`);
}

export type CategoryListItem = ReturnType<typeof listCategories>[number];

export function getCategory(db: DbOrTx, id: number, field?: string) {
  const row = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!row) throw new UserError("카테고리를 찾을 수 없습니다. 이미 지워졌을 수 있습니다.", field);
  return row;
}

// unique index(coalesce(parent_id, 0), name)와 같은 조건을 미리 찾아 알려준다.
function assertNameFree(db: DbOrTx, name: string, excludeId?: number) {
  const dup = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), excludeId === undefined ? undefined : ne(categories.id, excludeId)))
    .get();
  if (dup) throw new UserError(`"${name}" 카테고리가 이미 있습니다.`, "name");
}

// 같은 묶음의 맨 뒤 순서
function nextSortOrder(db: DbOrTx, group: CategoryGroup): number {
  const row = db.select({ max: max(categories.sortOrder) }).from(categories).where(eq(categories.group, group)).get();
  return row?.max == null ? 0 : row.max + 1;
}

export function createCategory(db: Db, input: CategoryInput): number {
  assertNameFree(db, input.name);
  return db
    .insert(categories)
    .values({ ...input, sortOrder: nextSortOrder(db, input.group) })
    .returning({ id: categories.id })
    .get().id;
}

// 이름과 묶음을 고친다. 묶음을 바꾸면 새 묶음의 맨 뒤로 간다.
export function updateCategory(db: Db, id: number, input: CategoryInput) {
  const current = getCategory(db, id);
  assertNotFixed(current.name);
  assertNameFree(db, input.name, id);
  const sortOrder = current.group === input.group ? current.sortOrder : nextSortOrder(db, input.group);
  db.update(categories).set({ ...input, sortOrder }).where(eq(categories.id, id)).run();
}

// 지우면 거래는 미분류(set null), 저장된 분류는 함께 지워진다(cascade).
// set null은 category_id만 비우므로 같은 트랜잭션에서 category_source도 비운다(미분류는 둘 다 null).
export function deleteCategory(db: Db, id: number) {
  assertNotFixed(getCategory(db, id).name);
  db.transaction((tx) => {
    tx.update(transactions).set({ categoryId: null, categorySource: null }).where(eq(transactions.categoryId, id)).run();
    tx.delete(categories).where(eq(categories.id, id)).run();
  });
}
