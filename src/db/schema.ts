// 테이블 정의. 각 컬럼의 뜻과 제약을 둔 이유는 docs/design.md 1장을 따른다.
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const ACCOUNT_KINDS = ["asset", "liability", "card"] as const;
export const INSTITUTIONS = ["hana_bank", "kb_bank", "kakao_bank", "hana_card", "kb_card", "kis"] as const;
export const TRANSACTION_KINDS = ["normal", "transfer", "adjustment"] as const;
export const TRANSACTION_SOURCES = ["upload", "manual", "system"] as const;
export const CATEGORY_SOURCES = ["saved", "ai", "user"] as const;
export const CATEGORY_RULE_SOURCES = ["ai", "user"] as const;
// 카테고리 묶음: 지출 / 수입 / 이동(5단계 파일 1.1)
export const CATEGORY_GROUPS = ["expense", "income", "move"] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export type Institution = (typeof INSTITUTIONS)[number];
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ACCOUNT_KINDS }).notNull(),
    institution: text("institution", { enum: INSTITUTIONS }),
    externalKey: text("external_key"),
    openingBalance: integer("opening_balance").notNull().default(0),
    openingDate: text("opening_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // 같은 금융사에서 external_key가 없는 계정은 1개만 둔다(카드사당 카드 계정 1개, 1.3-B).
    uniqueIndex("accounts_institution_external_key_unique")
      .on(t.institution, sql`coalesce(${t.externalKey}, '')`)
      .where(sql`${t.institution} is not null`),
  ],
);

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  insertedCount: integer("inserted_count").notNull(),
  deletedCount: integer("deleted_count").notNull(),
  backupPath: text("backup_path"),
  createdAt: createdAt(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id),
    group: text("group", { enum: CATEGORY_GROUPS }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_parent_name_unique").on(sql`coalesce(${t.parentId}, 0)`, t.name)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    source: text("source", { enum: TRANSACTION_SOURCES }).notNull(),
    date: text("date").notNull(),
    time: text("time"),
    seq: integer("seq"),
    amount: integer("amount").notNull(),
    description: text("description").notNull().default(""),
    method: text("method"),
    memo: text("memo"),
    cardLabel: text("card_label"),
    balanceAfter: integer("balance_after"),
    raw: text("raw", { mode: "json" }),
    importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
    transferPeerId: integer("transfer_peer_id").references((): AnySQLiteColumn => transactions.id, {
      onDelete: "set null",
    }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("transactions_amount_nonzero", sql`${t.amount} <> 0`),
    check("transactions_transfer_manual", sql`${t.kind} <> 'transfer' or ${t.source} = 'manual'`),
    check("transactions_adjustment_system", sql`${t.kind} <> 'adjustment' or ${t.source} = 'system'`),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_date_idx").on(t.date),
    index("transactions_category_idx").on(t.categoryId),
  ],
);

export const categoryRules = sqliteTable("category_rules", {
  id: integer("id").primaryKey(),
  matchKey: text("match_key").notNull().unique(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  source: text("source", { enum: CATEGORY_RULE_SOURCES }).notNull(),
  updatedAt: text("updated_at").notNull(),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});
