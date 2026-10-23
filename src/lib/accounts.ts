// 계정 조회·입력·수정·삭제·순서 바꾸기(design.md 2.3). 화면 규칙은 2단계 파일 1장.
import { and, asc, eq, getTableColumns, max, ne, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { accounts, type AccountKind, type Institution } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import { getBalances } from "@/lib/balance";
import { normalizeAccountKey } from "@/lib/import/account-key";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { UserError } from "@/lib/user-error";

// select 안의 컬럼은 테이블 이름 없이 렌더링돼 하위 쿼리에서 t.id로 잘못 읽히므로, 바깥 계정 id는 테이블 이름을 붙여 쓴다.
const outerAccountId = sql.raw(`"accounts"."id"`);

const kindOrder = sql`case ${accounts.kind} when 'asset' then 0 when 'liability' then 1 else 2 end`;

// 종류 묶음(자산 → 부채 → 카드) 안에서 sort_order 순. 거래 수와 업로드 기록 수, 잔액(카드 제외)을 함께 돌려준다.
export function listAccounts(db: Db) {
  const rows = db
    .select({
      ...getTableColumns(accounts),
      // 삭제 표시하지 않은 거래 수(목록에 보여주는 값)
      transactionCount: sql<number>`(select count(*) from transactions t where t.account_id = ${outerAccountId} and t.deleted_at is null)`,
      // 삭제 표시한 거래 포함(종류 변경 잠금과 삭제 확인 문구에 쓴다)
      allTransactionCount: sql<number>`(select count(*) from transactions t where t.account_id = ${outerAccountId})`,
      importCount: sql<number>`(select count(*) from imports i where i.account_id = ${outerAccountId})`,
    })
    .from(accounts)
    .orderBy(kindOrder, asc(accounts.sortOrder), asc(accounts.id))
    .all();
  const balances = getBalances(db);
  return rows.map((r) => ({ ...r, balance: balances.get(r.id) ?? null }));
}

export type AccountListItem = ReturnType<typeof listAccounts>[number];

// 금융사와 정규화한 계정 찾기 값이 같은 계정(3단계 파일 3장). 카드사는 금융사만으로 찾는다.
// 이미 저장된 external_key도 정규화해 비교하므로, 정규화 전에 저장한 값도 찾는다.
export function findAccountByKey(db: DbOrTx, institution: Institution, key: string | null, excludeId?: number) {
  const normalized = normalizeAccountKey(institution, key);
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.institution, institution), excludeId === undefined ? undefined : ne(accounts.id, excludeId)))
    .all()
    .find((a) => normalizeAccountKey(institution, a.externalKey) === normalized);
}

// unique index(institution, coalesce(external_key, ''))와 같은 조건을 미리 찾아, 겹치는 계정 이름으로 알려준다.
function assertNoDuplicate(db: DbOrTx, input: AccountInput, excludeId?: number) {
  if (!input.institution) return;
  const dup = findAccountByKey(db, input.institution, input.externalKey, excludeId);
  if (dup) {
    const institution = INSTITUTION_LABELS[input.institution];
    throw new UserError(
      input.kind === "card"
        ? `${institution} 계정 "${dup.name}"이(가) 이미 있습니다. 카드는 카드사마다 계정 하나만 둡니다.`
        : input.externalKey
          ? `같은 계좌 식별값의 ${institution} 계정 "${dup.name}"이(가) 이미 있습니다.`
          : `식별값 없는 ${institution} 계정 "${dup.name}"이(가) 이미 있습니다. 같은 금융사에서 식별값 없는 계정은 하나만 둘 수 있습니다.`,
      "externalKey",
    );
  }
}

// 같은 종류 묶음의 맨 아래 순서
function nextSortOrder(db: DbOrTx, kind: AccountKind): number {
  const row = db.select({ max: max(accounts.sortOrder) }).from(accounts).where(eq(accounts.kind, kind)).get();
  return row?.max == null ? 0 : row.max + 1;
}

// 업로드의 "계정 만들고 올리기"가 반영 트랜잭션 안에서도 부른다(3단계 파일 3장).
export function createAccount(db: DbOrTx, input: AccountInput): number {
  assertNoDuplicate(db, input);
  const row = db
    .insert(accounts)
    .values({ ...input, sortOrder: nextSortOrder(db, input.kind) })
    .returning({ id: accounts.id })
    .get();
  return row.id;
}

export function updateAccount(db: Db, id: number, input: AccountInput) {
  const current = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!current) throw new UserError("계정을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.");

  let sortOrder = current.sortOrder;
  if (input.kind !== current.kind) {
    // 거래가 있으면 종류를 바꿀 수 없다(삭제 표시한 거래 포함, 2단계 파일 1.2).
    const row = db.get<{ n: number }>(sql`select count(*) as n from transactions where account_id = ${id}`);
    if (row && row.n > 0) throw new UserError("거래가 있는 계정은 종류를 바꿀 수 없습니다. 새 계정을 만드세요.", "kind");
    sortOrder = nextSortOrder(db, input.kind);
  }
  assertNoDuplicate(db, input, id);
  db.update(accounts).set({ ...input, sortOrder }).where(eq(accounts.id, id)).run();
}

// 거래와 업로드 기록은 on delete cascade로 함께 지워지고, 이체 반대쪽의 transfer_peer_id는 null이 된다(2단계 파일 1.3).
export function deleteAccount(db: Db, id: number) {
  db.delete(accounts).where(eq(accounts.id, id)).run();
}

// 같은 종류 묶음 안에서 바로 위·아래 계정과 순서를 바꾼다(2단계 파일 1.4).
// sort_order가 겹쳐 있어도 순서가 분명하도록 묶음 전체를 0부터 다시 매긴다.
export function moveAccount(db: Db, id: number, direction: "up" | "down") {
  db.transaction((tx) => {
    const current = tx.select({ kind: accounts.kind }).from(accounts).where(eq(accounts.id, id)).get();
    if (!current) return;
    const ids = tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.kind, current.kind))
      .orderBy(asc(accounts.sortOrder), asc(accounts.id))
      .all()
      .map((r) => r.id);
    const from = ids.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    ids.forEach((accountId, index) => {
      tx.update(accounts).set({ sortOrder: index }).where(eq(accounts.id, accountId)).run();
    });
  });
}
