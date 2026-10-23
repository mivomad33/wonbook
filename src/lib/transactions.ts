// 거래 조회·입력·수정·삭제 표시(design.md 2.3). 화면 규칙은 2단계 파일 2·3장.
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import { accounts, categories, transactions } from "@/db/schema";
import { getAccount } from "@/lib/accounts";
import { getCategory } from "@/lib/categories";
import { shiftMonth } from "@/lib/format";
import { descNullsLast } from "@/lib/sql";
import type { TransactionFilter } from "@/lib/transaction-filter";
import type { TransactionInput, TransferInput } from "@/lib/transaction-form";
import { UserError } from "@/lib/user-error";

const peer = alias(transactions, "peer");
const peerAccount = alias(accounts, "peer_account");

// 최신 거래가 위다. 시각이 없는 거래는 같은 날짜의 맨 아래(2단계 파일 2.3). 그 사용자의 거래만 본다.
export async function listTransactions(db: DbOrTx, userId: number, filter: TransactionFilter) {
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountKind: accounts.kind,
      kind: transactions.kind,
      source: transactions.source,
      date: transactions.date,
      time: transactions.time,
      amount: transactions.amount,
      description: transactions.description,
      method: transactions.method,
      memo: transactions.memo,
      cardLabel: transactions.cardLabel,
      editedAt: transactions.editedAt,
      deletedAt: transactions.deletedAt,
      transferPeerId: transactions.transferPeerId,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      peerAccountId: peer.accountId,
      peerAccountName: peerAccount.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(peer, eq(peer.id, transactions.transferPeerId))
    .leftJoin(peerAccount, eq(peerAccount.id, peer.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        filter.accountId != null
          ? eq(transactions.accountId, filter.accountId)
          : filter.group === "account"
            ? ne(accounts.kind, "card")
            : filter.group === "card"
              ? eq(accounts.kind, "card")
              : undefined,
        filter.month === "all"
          ? undefined
          : and(gte(transactions.date, `${filter.month}-01`), lt(transactions.date, `${shiftMonth(filter.month, 1)}-01`)),
        // 미분류는 카테고리를 붙일 수 있는 일반 거래만 본다. 이체·보정은 카테고리가 없어도 미분류가 아니다(5단계 파일 2장).
        filter.categoryId === "none"
          ? and(eq(transactions.kind, "normal"), isNull(transactions.categoryId))
          : filter.categoryId != null
            ? eq(transactions.categoryId, filter.categoryId)
            : undefined,
        filter.showDeleted ? undefined : isNull(transactions.deletedAt),
      ),
    )
    .orderBy(
      desc(transactions.date),
      asc(isNull(transactions.time)),
      desc(transactions.time),
      descNullsLast(transactions.seq),
      desc(transactions.id),
    );
}

export type TransactionListItem = Awaited<ReturnType<typeof listTransactions>>[number];

// 건수, 수입(양수 합), 지출(음수 합의 부호를 뒤집은 값). 이체도 넣고, 삭제 표시한 거래는 뺀다(2단계 파일 2.2).
export function summarizeTransactions(rows: { amount: number; deletedAt: string | null }[]) {
  const live = rows.filter((r) => r.deletedAt == null);
  return {
    count: live.length,
    income: live.reduce((s, r) => (r.amount > 0 ? s + r.amount : s), 0),
    expense: live.reduce((s, r) => (r.amount < 0 ? s - r.amount : s), 0),
  };
}

// 그 사용자의 거래 하나. 없거나 남의 거래면 UserError.
async function getTransaction(db: DbOrTx, userId: number, id: number) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!row) throw new UserError("거래를 찾을 수 없습니다. 이미 지워졌을 수 있습니다.");
  return row;
}

// 보정 거래는 파일의 실제 잔액에서 계산한 값이라 고치거나 삭제 표시할 수 없다. 버튼을 숨기지만 서버에서도 막는다(4단계 파일 5장).
function assertNotAdjustment(row: { kind: string }) {
  if (row.kind === "adjustment") {
    throw new UserError("보정 거래는 고치거나 삭제할 수 없습니다. 원인이 된 거래나 기초 잔액을 고치고 파일을 다시 올리세요.");
  }
}

// 삭제 표시한 거래는 수정 버튼을 숨기지만, 서버에서도 막는다(2단계 파일 3.4).
async function getEditableTransaction(db: DbOrTx, userId: number, id: number) {
  const row = await getTransaction(db, userId, id);
  assertNotAdjustment(row);
  if (row.deletedAt) throw new UserError("삭제 표시한 거래는 되살린 뒤 고칠 수 있습니다.");
  return row;
}

// 카드 계정은 잔액이 없어 이체 대상이 아니다(2단계 파일 3.2).
async function getTransferAccount(db: DbOrTx, userId: number, id: number | null, field: "fromAccountId" | "toAccountId") {
  if (id == null) throw new UserError("계정을 고르세요.", field);
  const account = await getAccount(db, userId, id, field);
  if (account.kind === "card") throw new UserError("카드 계정으로는 이체할 수 없습니다.", field);
  return account;
}

const now = () => new Date().toISOString();

// 이체 두 건에 같은 값을 넣는 칸(2단계 파일 3.2)
const transferCommon = ({ date, time, description, memo }: TransferInput) => ({ date, time, description, memo });

// 수동 거래의 카테고리. 고르면 user로 붙고 category_rules는 만들지 않는다(5단계 파일 2장).
async function manualCategory(db: DbOrTx, userId: number, categoryId: number | null | undefined) {
  if (categoryId == null) return { categoryId: null, categorySource: null };
  await getCategory(db, userId, categoryId, "categoryId");
  return { categoryId, categorySource: "user" as const };
}

const own = (userId: number, id: number) => and(eq(transactions.id, id), eq(transactions.userId, userId));

// 수동 일반 거래 1건(design.md 1.4)
export async function createTransaction(db: DbOrTx, userId: number, { categoryId, ...input }: TransactionInput): Promise<number> {
  await getAccount(db, userId, input.accountId, "accountId");
  const [row] = await db
    .insert(transactions)
    .values({ ...input, ...(await manualCategory(db, userId, categoryId)), userId, kind: "normal", source: "manual" })
    .returning({ id: transactions.id });
  return row.id;
}

// 수동 거래는 모든 칸, 업로드 거래는 계정을 빼고 고치며 edited_at을 채운다(2단계 파일 3.3).
// 업로드 거래의 카테고리는 이 폼에서 바꾸지 않는다(배지에서 바꿔 규칙과 함께 저장한다, 5단계 파일 7.1).
export async function updateTransaction(db: DbOrTx, userId: number, id: number, { categoryId, ...input }: TransactionInput): Promise<void> {
  const current = await getEditableTransaction(db, userId, id);
  if (current.kind !== "normal") throw new UserError("일반 거래만 이 폼으로 고칠 수 있습니다.");
  if (current.source === "upload") {
    if (input.accountId !== current.accountId) throw new UserError("업로드 거래는 계정을 바꿀 수 없습니다.", "accountId");
    await db.update(transactions).set({ ...input, editedAt: now() }).where(own(userId, id));
    return;
  }
  await getAccount(db, userId, input.accountId, "accountId");
  await db
    .update(transactions)
    .set({ ...input, ...(await manualCategory(db, userId, categoryId)) })
    .where(own(userId, id));
}

// 보내는 쪽 −금액, 받는 쪽 +금액 거래 2건을 넣고 서로의 transfer_peer_id를 채운다(design.md 1.4).
export async function createTransfer(db: DbOrTx, userId: number, input: TransferInput): Promise<[number, number]> {
  const from = await getTransferAccount(db, userId, input.fromAccountId, "fromAccountId");
  const to = await getTransferAccount(db, userId, input.toAccountId, "toAccountId");
  const { amount } = input;
  return db.transaction(async (tx) => {
    const base = { ...transferCommon(input), userId, kind: "transfer" as const, source: "manual" as const };
    const [out] = await tx
      .insert(transactions)
      .values({ ...base, accountId: from.id, amount: -amount })
      .returning({ id: transactions.id });
    const [inn] = await tx
      .insert(transactions)
      .values({ ...base, accountId: to.id, amount, transferPeerId: out.id })
      .returning({ id: transactions.id });
    await tx.update(transactions).set({ transferPeerId: inn.id }).where(own(userId, out.id));
    return [out.id, inn.id];
  });
}

// 어느 쪽 id로 불러도 두 건을 함께 고친다. 반대쪽이 없으면 남은 한 건만 고친다(2단계 파일 3.3).
export async function updateTransfer(db: DbOrTx, userId: number, id: number, input: TransferInput): Promise<void> {
  const row = await getEditableTransaction(db, userId, id);
  if (row.kind !== "transfer") throw new UserError("이체만 이 폼으로 고칠 수 있습니다.");
  const peerRow = row.transferPeerId == null ? null : await getTransaction(db, userId, row.transferPeerId);
  const [out, inn] = row.amount < 0 ? [row, peerRow] : [peerRow, row];
  const { amount } = input;
  const common = transferCommon(input);
  const from = out && (await getTransferAccount(db, userId, input.fromAccountId, "fromAccountId"));
  const to = inn && (await getTransferAccount(db, userId, input.toAccountId, "toAccountId"));
  await db.transaction(async (tx) => {
    if (out && from) {
      await tx.update(transactions).set({ ...common, accountId: from.id, amount: -amount }).where(own(userId, out.id));
    }
    if (inn && to) {
      await tx.update(transactions).set({ ...common, accountId: to.id, amount }).where(own(userId, inn.id));
    }
  });
}

// 삭제 표시와 되살리기. 이체는 반대쪽도 함께 바꾼다(2단계 파일 3.4). 되살려도 edited_at은 그대로 둔다.
export async function setTransactionDeleted(db: DbOrTx, userId: number, id: number, deleted: boolean): Promise<void> {
  const row = await getTransaction(db, userId, id);
  assertNotAdjustment(row);
  const ids = row.kind === "transfer" && row.transferPeerId != null ? [row.id, row.transferPeerId] : [row.id];
  await db
    .update(transactions)
    .set({ deletedAt: deleted ? now() : null })
    .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId)));
}
