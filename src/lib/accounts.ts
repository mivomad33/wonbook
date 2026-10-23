// 계정 조회·입력·수정·삭제·순서 바꾸기(design.md 2.3). 화면 규칙은 2단계 파일 1장.
// 모든 조회·변경은 그 사용자의 계정만 본다(4.2-2). 남의 계정 id는 없는 계정과 같다.
import { and, asc, eq, getTableColumns, isNull, max, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, type AccountKind, type Institution, transactions } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import { getBalances } from "@/lib/balance";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { accountKeyHash } from "@/lib/privacy/account-key-server";
import { countAll } from "@/lib/sql";
import { UserError } from "@/lib/user-error";

// select 안의 컬럼은 테이블 이름 없이 렌더링돼 하위 쿼리에서 t.id로 잘못 읽히므로, 바깥 계정 id는 테이블 이름을 붙여 쓴다.
const outerAccountId = sql.raw(`"accounts"."id"`);

const kindOrder = sql`case ${accounts.kind} when 'asset' then 0 when 'liability' then 1 else 2 end`;

const NOT_FOUND = "계정을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.";

// 화면으로 보내는 칸. 식별값 해시는 브라우저로 보내지 않는다(4.7-4). 화면에는 끝 4자리(externalKeyLast4)만 보인다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { externalKeyHash: _hash, ...listColumns } = getTableColumns(accounts);

// 종류 묶음(자산 → 부채 → 카드) 안에서 sort_order 순. 거래 수와 업로드 기록 수, 잔액(카드 제외)을 함께 돌려준다.
export async function listAccounts(db: DbOrTx, userId: number) {
  const rows = await db
    .select({
      ...listColumns,
      // 삭제 표시하지 않은 거래 수(목록에 보여주는 값)
      transactionCount: sql<number>`(select count(*) from transactions t where t.account_id = ${outerAccountId} and t.deleted_at is null)`.mapWith(Number),
      // 삭제 표시한 거래 포함(종류 변경 잠금과 삭제 확인 문구에 쓴다)
      allTransactionCount: sql<number>`(select count(*) from transactions t where t.account_id = ${outerAccountId})`.mapWith(Number),
      importCount: sql<number>`(select count(*) from imports i where i.account_id = ${outerAccountId})`.mapWith(Number),
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(kindOrder, asc(accounts.sortOrder), asc(accounts.id));
  const balances = await getBalances(db, userId);
  return rows.map((r) => ({ ...r, balance: balances.get(r.id) ?? null }));
}

export type AccountListItem = Awaited<ReturnType<typeof listAccounts>>[number];

// 그 사용자의 계정 하나. 없거나 남의 계정이면 UserError.
export async function getAccount(db: DbOrTx, userId: number, id: number, field?: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
  if (!row) throw new UserError(NOT_FOUND, field);
  return row;
}

// 금융사와 계좌 식별값(브라우저가 보낸 해시)이 같은 계정(3단계 파일 3장). 카드사는 금융사만으로 찾는다.
// 저장된 값은 서버 키를 더한 해시라 같은 함수로 만들어 비교한다(4.7-1).
export async function findAccountByKey(db: DbOrTx, userId: number, institution: Institution, digest: string | null, excludeId?: number) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.institution, institution),
        digest == null ? isNull(accounts.externalKeyHash) : eq(accounts.externalKeyHash, accountKeyHash(digest)),
        excludeId === undefined ? undefined : ne(accounts.id, excludeId),
      ),
    )
    .limit(1);
  return row;
}

// 저장할 식별값 칸. accountKey가 undefined면(수정 때 그대로 두기) 바꾸지 않는다.
function keyColumns(accountKey: AccountInput["accountKey"]) {
  if (accountKey === undefined) return {};
  return accountKey
    ? { externalKeyHash: accountKeyHash(accountKey.digest), externalKeyLast4: accountKey.last4 }
    : { externalKeyHash: null, externalKeyLast4: null };
}

// unique index(user_id, institution, coalesce(external_key_hash, ''))와 같은 조건을 미리 찾아, 겹치는 계정 이름으로 알려준다.
async function assertNoDuplicate(
  db: DbOrTx,
  userId: number,
  input: Pick<AccountInput, "institution" | "kind">,
  keyHash: string | null,
  excludeId?: number,
) {
  if (!input.institution) return;
  const [dup] = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.institution, input.institution),
        keyHash == null ? isNull(accounts.externalKeyHash) : eq(accounts.externalKeyHash, keyHash),
        excludeId === undefined ? undefined : ne(accounts.id, excludeId),
      ),
    )
    .limit(1);
  if (dup) {
    const institution = INSTITUTION_LABELS[input.institution];
    throw new UserError(
      input.kind === "card"
        ? `${institution} 계정 "${dup.name}"이(가) 이미 있습니다. 카드는 카드사마다 계정 하나만 둡니다.`
        : keyHash
          ? `같은 계좌 식별값의 ${institution} 계정 "${dup.name}"이(가) 이미 있습니다.`
          : `식별값 없는 ${institution} 계정 "${dup.name}"이(가) 이미 있습니다. 같은 금융사에서 식별값 없는 계정은 하나만 둘 수 있습니다.`,
      "externalKey",
    );
  }
}

// 같은 종류 묶음의 맨 아래 순서
async function nextSortOrder(db: DbOrTx, userId: number, kind: AccountKind): Promise<number> {
  const [row] = await db
    .select({ max: max(accounts.sortOrder) })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.kind, kind)));
  return row?.max == null ? 0 : row.max + 1;
}

// 업로드의 "계정 만들고 올리기"가 반영 트랜잭션 안에서도 부른다(3단계 파일 3장).
export async function createAccount(db: DbOrTx, userId: number, input: AccountInput): Promise<number> {
  const { accountKey, ...values } = input;
  const keys = keyColumns(accountKey ?? null);
  await assertNoDuplicate(db, userId, input, keys.externalKeyHash ?? null);
  const [row] = await db
    .insert(accounts)
    .values({ ...values, ...keys, userId, sortOrder: await nextSortOrder(db, userId, input.kind) })
    .returning({ id: accounts.id });
  return row.id;
}

export async function updateAccount(db: DbOrTx, userId: number, id: number, input: AccountInput): Promise<void> {
  const current = await getAccount(db, userId, id);
  const { accountKey, ...values } = input;
  // 금융사가 바뀌면 저장된 식별값(금융사를 넣어 만든 해시)은 맞지 않으므로 비운다.
  const keys = keyColumns(accountKey === undefined && input.institution !== current.institution ? null : accountKey);
  const keyHash = "externalKeyHash" in keys ? (keys.externalKeyHash ?? null) : current.externalKeyHash;

  let sortOrder = current.sortOrder;
  if (input.kind !== current.kind) {
    // 거래가 있으면 종류를 바꿀 수 없다(삭제 표시한 거래 포함, 2단계 파일 1.2).
    const [row] = await db.select({ n: countAll() }).from(transactions).where(eq(transactions.accountId, id));
    if (row && row.n > 0) throw new UserError("거래가 있는 계정은 종류를 바꿀 수 없습니다. 새 계정을 만드세요.", "kind");
    sortOrder = await nextSortOrder(db, userId, input.kind);
  }
  await assertNoDuplicate(db, userId, input, keyHash, id);
  await db
    .update(accounts)
    .set({ ...values, ...keys, sortOrder })
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
}

// 거래와 업로드 기록은 on delete cascade로 함께 지워지고, 이체 반대쪽의 transfer_peer_id는 null이 된다(2단계 파일 1.3).
export async function deleteAccount(db: DbOrTx, userId: number, id: number): Promise<void> {
  await getAccount(db, userId, id);
  await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
}

// 같은 종류 묶음 안에서 바로 위·아래 계정과 순서를 바꾼다(2단계 파일 1.4).
// sort_order가 겹쳐 있어도 순서가 분명하도록 묶음 전체를 0부터 다시 매긴다.
export async function moveAccount(db: DbOrTx, userId: number, id: number, direction: "up" | "down"): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getAccount(tx, userId, id);
    const ids = (
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.kind, current.kind)))
        .orderBy(asc(accounts.sortOrder), asc(accounts.id))
    ).map((r) => r.id);
    const from = ids.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    for (const [index, accountId] of ids.entries()) {
      await tx.update(accounts).set({ sortOrder: index }).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    }
  });
}
