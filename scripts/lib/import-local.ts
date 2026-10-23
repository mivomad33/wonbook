// 내 데이터 이전(4.8-3): 로컬 앱 DB(data/wonbook.db, 예전 SQLite 스키마)를 원격 DB의 관리자 계정으로 옮긴다.
// - 계좌번호는 해시와 끝 4자리로 바꾼다(업로드·계정 폼과 같은 순서: 키 없는 해시 → 서버 키 HMAC, 4.7-1).
// - 거래 내용·거래 방식·메모·카드 표시·업로드 파일 이름의 계좌번호는 가린다(2.2). 거래 원본 행(raw)과 DB 파일 백업 경로는 옮기지 않는다.
// - 카테고리(고친 것 포함)·저장된 분류·설정은 그대로 옮긴다. 기본 카테고리를 따로 만들지 않는다. 카카오뱅크 암호는 옮기지 않는다.
// - 옮긴 업로드에는 되돌리기 자료가 없다(되돌릴 수 없음, 4.3-5).
// - 관리자 계정이 없으면 관리자 이메일로 만든다(구글 id 없음, 첫 로그인 때 연결, 4.1-7). 이미 데이터가 있으면 아무것도 바꾸지 않고 멈춘다(다시 실행해도 두 번 들어가지 않는다).
// 모두 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다. 출력에는 개수만 쓰고 내용은 쓰지 않는다.
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { accounts, categories, categoryRules, imports, settings, transactions, users } from "@/db/schema";
import type { AccountKind, CategoryGroup, Institution, TransactionKind, TransactionSource } from "@/db/schema";
import { toAccountKeyRef } from "@/lib/privacy/account-key";
import { accountKeyHash } from "@/lib/privacy/account-key-server";
import { maskAccountNumbers } from "@/lib/privacy/mask";

export type LocalDb = Database.Database;

export function openLocal(file: string): LocalDb {
  return new Database(file, { readonly: true, fileMustExist: true });
}

type LocalAccount = {
  id: number;
  name: string;
  kind: AccountKind;
  institution: Institution | null;
  external_key: string | null;
  opening_balance: number;
  opening_date: string | null;
  sort_order: number;
  created_at: string;
};
type LocalCategory = { id: number; name: string; parent_id: number | null; group: CategoryGroup; sort_order: number; created_at: string };
type LocalImport = {
  id: number;
  account_id: number;
  file_name: string;
  period_start: string;
  period_end: string;
  inserted_count: number;
  deleted_count: number;
  created_at: string;
};
type LocalTransaction = {
  id: number;
  account_id: number;
  kind: TransactionKind;
  source: TransactionSource;
  date: string;
  time: string | null;
  seq: number | null;
  amount: number;
  description: string;
  method: string | null;
  memo: string | null;
  card_label: string | null;
  balance_after: number | null;
  import_id: number | null;
  transfer_peer_id: number | null;
  category_id: number | null;
  category_source: "saved" | "ai" | "user" | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};
type LocalRule = { match_key: string; category_id: number; source: "ai" | "user"; updated_at: string; created_at: string };
type LocalSetting = { key: string; value: string; created_at: string };

export type ImportCounts = { accounts: number; categories: number; imports: number; transactions: number; rules: number; settings: number };
export type ImportResult = { status: "imported" | "already"; userId: number; counts: ImportCounts };

/**
 * verbatim: 비교 기준을 만들 때만 쓴다(가리기·해시 없이 그대로 옮긴다). 원격 DB에는 쓰지 않는다.
 */
export async function importLocal(db: Db, local: LocalDb, opts: { email: string; verbatim?: boolean }): Promise<ImportResult> {
  const email = opts.email.trim().toLowerCase();
  const maskText = (s: string): string => (opts.verbatim ? s : maskAccountNumbers(s));
  const mask = (s: string | null): string | null => (opts.verbatim ? s : maskAccountNumbers(s));
  const rows = <T>(sql: string) => local.prepare(sql).all() as T[];
  const src = {
    accounts: rows<LocalAccount>("select * from accounts order by id"),
    categories: rows<LocalCategory>("select * from categories order by (parent_id is not null), id"),
    imports: rows<LocalImport>("select * from imports order by id"),
    transactions: rows<LocalTransaction>("select * from transactions order by id"),
    rules: rows<LocalRule>("select * from category_rules order by id"),
    settings: rows<LocalSetting>("select * from settings order by key"),
  };
  const counts: ImportCounts = {
    accounts: src.accounts.length,
    categories: src.categories.length,
    imports: src.imports.length,
    transactions: src.transactions.length,
    rules: src.rules.length,
    settings: src.settings.length,
  };

  return db.transaction(async (tx) => {
    const userId = await adminUser(tx, email);
    const [existing] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId)).limit(1);
    const [existingCategory] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId)).limit(1);
    if (existing || existingCategory) return { status: "already", userId, counts };

    const categoryIds = new Map<number, number>();
    for (const c of src.categories) {
      const parentId = c.parent_id == null ? null : categoryIds.get(c.parent_id);
      if (parentId === undefined) throw new Error("상위 카테고리를 찾지 못했습니다");
      const [row] = await tx
        .insert(categories)
        .values({ userId, name: c.name, parentId, group: c.group, sortOrder: c.sort_order, createdAt: c.created_at })
        .returning({ id: categories.id });
      categoryIds.set(c.id, row.id);
    }

    const accountIds = new Map<number, number>();
    for (const a of src.accounts) {
      const ref = opts.verbatim ? null : await toAccountKeyRef(a.institution, a.external_key);
      const [row] = await tx
        .insert(accounts)
        .values({
          userId,
          name: a.name,
          kind: a.kind,
          institution: a.institution,
          externalKeyHash: opts.verbatim ? a.external_key : ref && accountKeyHash(ref.digest),
          externalKeyLast4: opts.verbatim ? a.external_key : (ref?.last4 ?? null),
          openingBalance: a.opening_balance,
          openingDate: a.opening_date,
          sortOrder: a.sort_order,
          createdAt: a.created_at,
        })
        .returning({ id: accounts.id });
      accountIds.set(a.id, row.id);
    }

    const importIds = new Map<number, number>();
    for (const i of src.imports) {
      const [row] = await tx
        .insert(imports)
        .values({
          userId,
          accountId: need(accountIds, i.account_id),
          fileName: maskText(i.file_name),
          periodStart: i.period_start,
          periodEnd: i.period_end,
          insertedCount: i.inserted_count,
          deletedCount: i.deleted_count,
          createdAt: i.created_at,
        })
        .returning({ id: imports.id });
      importIds.set(i.id, row.id);
    }

    // 이체 짝은 모두 넣은 뒤 잇는다(서로를 가리키기 때문이다).
    const txIds = new Map<number, number>();
    for (const chunk of chunks(src.transactions, 500)) {
      const inserted = await tx
        .insert(transactions)
        .values(
          chunk.map((t) => ({
            userId,
            accountId: need(accountIds, t.account_id),
            kind: t.kind,
            source: t.source,
            date: t.date,
            time: t.time,
            seq: t.seq,
            amount: t.amount,
            description: maskText(t.description),
            method: mask(t.method),
            memo: mask(t.memo),
            cardLabel: mask(t.card_label),
            balanceAfter: t.balance_after,
            importId: t.import_id == null ? null : (importIds.get(t.import_id) ?? null),
            categoryId: t.category_id == null ? null : need(categoryIds, t.category_id),
            categorySource: t.category_source,
            editedAt: t.edited_at,
            deletedAt: t.deleted_at,
            createdAt: t.created_at,
          })),
        )
        .returning({ id: transactions.id });
      chunk.forEach((t, i) => txIds.set(t.id, inserted[i].id));
    }
    for (const t of src.transactions) {
      if (t.transfer_peer_id == null) continue;
      const peer = txIds.get(t.transfer_peer_id);
      if (peer === undefined) continue;
      await tx.update(transactions).set({ transferPeerId: peer }).where(eq(transactions.id, need(txIds, t.id)));
    }

    for (const chunk of chunks(src.rules, 500)) {
      await tx.insert(categoryRules).values(
        chunk.map((r) => ({
          userId,
          matchKey: r.match_key,
          categoryId: need(categoryIds, r.category_id),
          source: r.source,
          updatedAt: r.updated_at,
          createdAt: r.created_at,
        })),
      );
    }

    for (const s of src.settings) {
      await tx.insert(settings).values({ userId, key: s.key, value: parseJson(s.value), createdAt: s.created_at });
    }
    return { status: "imported", userId, counts };
  });
}

async function adminUser(tx: Tx, email: string): Promise<number> {
  const [found] = await tx.select({ id: users.id, isDemo: users.isDemo }).from(users).where(eq(users.email, email));
  if (found?.isDemo) throw new Error("관리자 이메일이 데모 사용자와 같습니다");
  if (found) return found.id;
  const [created] = await tx.insert(users).values({ email }).returning({ id: users.id });
  return created.id;
}

function need(map: Map<number, number>, id: number): number {
  const v = map.get(id);
  if (v === undefined) throw new Error("이전 중 연결할 행을 찾지 못했습니다");
  return v;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
