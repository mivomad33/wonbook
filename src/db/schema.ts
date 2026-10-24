// 테이블 정의. 각 컬럼의 뜻과 제약을 둔 이유는 docs/design.md 1장을 따른다.
// 가계부 데이터는 모두 사용자별이다(user_id). 다른 사용자의 행을 읽거나 바꾸지 않도록 모든 조회에 user_id를 건다.
import { type AnyPgColumn, bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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

// 금액은 원 단위 정수. 잔액·합계가 21억을 넘을 수 있어 bigint로 두고, JS에서는 number로 다룬다(안전한 정수 범위 안).
const money = (name: string) => bigint(name, { mode: "number" });

// 기록 시각은 ISO 문자열(UTC)로 둔다. 화면 표시와 날짜 경계는 한국 시간으로 바꿔 계산한다(lib/day.ts).
const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

const userId = () =>
  integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // 구글 계정의 고유 id. 관리자 계정은 이전 때 미리 만들어 두고 첫 로그인 때 채운다(4.1-7).
  googleSub: text("google_sub").unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  picture: text("picture"),
  // 데모 전용 사용자. 로그인할 수 없고, 데모 세션은 읽기만 한다(4.5).
  isDemo: boolean("is_demo").notNull().default(false),
  // 카카오뱅크 파일 암호(서버 키로 암호화한 값, 4.3-4). 평문은 저장하지 않는다.
  kakaoPasswordEnc: text("kakao_password_enc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  // 쿠키 토큰의 SHA-256. 토큰 자체는 저장하지 않는다.
  id: text("id").primaryKey(),
  userId: userId(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ACCOUNT_KINDS }).notNull(),
    institution: text("institution", { enum: INSTITUTIONS }),
    // 계좌 식별값. 계좌번호 전체는 저장하지 않는다(4.7-1).
    // key_hash: 서버 키로 만든 해시(파일과 계정 맞추기), key_last4: 화면에 보일 끝 4자리
    externalKeyHash: text("external_key_hash"),
    externalKeyLast4: text("external_key_last4"),
    openingBalance: money("opening_balance").notNull().default(0),
    openingDate: text("opening_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // 같은 사용자·금융사에서 식별값이 없는 계정은 1개만 둔다(카드사당 카드 계정 1개, 1.3-B).
    uniqueIndex("accounts_user_institution_key_unique")
      .on(t.userId, t.institution, sql`coalesce(${t.externalKeyHash}, '')`)
      .where(sql`${t.institution} is not null`),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const imports = pgTable(
  "imports",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // 계좌번호처럼 긴 숫자는 가려서 저장한다(2.2).
    fileName: text("file_name").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    insertedCount: integer("inserted_count").notNull(),
    deletedCount: integer("deleted_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("imports_user_idx").on(t.userId, t.createdAt)],
);

// 업로드 되돌리기 자료(4.3-5). 그 업로드가 지운 거래를 그대로 남겨 둔다. 계정마다 가장 최근 업로드에만 있고,
// 그 계정에 새 업로드가 반영되거나 되돌리면 지운다. 이 행이 없는 업로드(이전한 업로드 등)는 되돌릴 수 없다.
export const importUndo = pgTable("import_undo", {
  importId: integer("import_id")
    .primaryKey()
    .references(() => imports.id, { onDelete: "cascade" }),
  userId: userId(),
  // 지운 거래의 행 전체(id 포함). 되돌릴 때 같은 id로 다시 넣는다.
  deletedRows: jsonb("deleted_rows").notNull(),
  // 업로드 뒤 손댄 거래를 찾는 기준 시각(되돌리기 확인, 4.3-5)
  appliedAt: text("applied_at").notNull(),
});

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    name: text("name").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id),
    group: text("group", { enum: CATEGORY_GROUPS }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // 화면 색·아이콘 이름(lib/category-style.ts의 목록 중 하나, design-refresh 명세서 4.5). 기본값은 회색·태그다.
    color: text("color").notNull().default("gray"),
    icon: text("icon").notNull().default("tag"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_user_parent_name_unique").on(t.userId, sql`coalesce(${t.parentId}, 0)`, t.name)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    source: text("source", { enum: TRANSACTION_SOURCES }).notNull(),
    date: text("date").notNull(),
    time: text("time"),
    seq: integer("seq"),
    amount: money("amount").notNull(),
    description: text("description").notNull().default(""),
    method: text("method"),
    memo: text("memo"),
    cardLabel: text("card_label"),
    balanceAfter: money("balance_after"),
    importId: integer("import_id").references(() => imports.id, { onDelete: "set null" }),
    transferPeerId: integer("transfer_peer_id").references((): AnyPgColumn => transactions.id, {
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
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_category_idx").on(t.categoryId),
  ],
);

export const categoryRules = pgTable(
  "category_rules",
  {
    id: serial("id").primaryKey(),
    userId: userId(),
    matchKey: text("match_key").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    source: text("source", { enum: CATEGORY_RULE_SOURCES }).notNull(),
    updatedAt: text("updated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_rules_user_key_unique").on(t.userId, t.matchKey)],
);

export const settings = pgTable(
  "settings",
  {
    userId: userId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// 나눠 보낸 업로드 조각(4.3-2). 한 요청은 Vercel 본문 한도(4.5MB)보다 작아야 해서, 브라우저가 업로드 값(JSON)을 조각으로 나눠
// 보내고 마지막에 한 번에 반영한다. 반영하면 지우고, 한 시간 넘게 남은 조각은 다음 업로드 때 지운다.
export const uploadStaging = pgTable(
  "upload_staging",
  {
    userId: userId(),
    token: text("token").notNull(),
    part: integer("part").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.token, t.part] })],
);

// 분류 한도(4.4-2). 사용자별 하루 키 수. 날짜는 한국 시간 기준 YYYY-MM-DD.
export const classifyUsage = pgTable(
  "classify_usage",
  {
    userId: userId(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

// 전체 하루 키 수. 사용자와 연결하지 않아 탈퇴해도 줄지 않는다(4.1-6).
export const classifyUsageTotal = pgTable("classify_usage_total", {
  day: text("day").primaryKey(),
  count: integer("count").notNull().default(0),
});
