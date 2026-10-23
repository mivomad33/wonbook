// 기간 덮어쓰기와 손댄 거래 확인(3단계 파일 5.3, design.md 1.4), 업로드 되돌리기(4.3-5).
// uploadFiles(upload.ts)가 계정 찾기 → planImport → applyImport 순서로 부른다. 모든 함수는 그 사용자의 계정·거래만 본다.
import { and, asc, between, count, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { categories, importUndo, imports, transactions } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import { createAccount, getAccount } from "@/lib/accounts";
import { computeAdjustments, getBalanceBefore } from "@/lib/balance";
import { attachSavedCategory, loadRules } from "@/lib/categorize";
import { ascNullsFirst } from "@/lib/sql";
import { UserError } from "@/lib/user-error";
import type { UploadedFile } from "./payload";

export { normalizeAccountKey } from "./account-key";
export { openingFromFile } from "./opening";
export { toUploadedFile, type UploadedFile, type UploadedTransaction, type UploadRequestFile } from "./payload";
export { MAX_TEXT_LENGTH, MAX_TRANSACTIONS_PER_REQUEST, parseUploadRequest } from "./validate";

// 반영에 쓰는 파일 값. 파일 이름·계좌 식별값은 계정 찾기와 기록에만 쓴다.
export type ImportData = Pick<UploadedFile, "institution" | "period" | "transactions">;

type TransactionRow = typeof transactions.$inferSelect;

// 사용자가 손댄 거래: 수동, 수정함, 삭제 표시(design.md 1.2 transactions)
const touched = or(eq(transactions.source, "manual"), isNotNull(transactions.editedAt), isNotNull(transactions.deletedAt));

const inPeriod = (userId: number, accountId: number, period: ImportData["period"]) =>
  and(eq(transactions.userId, userId), eq(transactions.accountId, accountId), between(transactions.date, period.start, period.end));

// 확인 대화상자(3단계 파일 7.2)에 보여줄 칸
const touchedColumns = {
  id: transactions.id,
  kind: transactions.kind,
  source: transactions.source,
  date: transactions.date,
  time: transactions.time,
  amount: transactions.amount,
  description: transactions.description,
  editedAt: transactions.editedAt,
  deletedAt: transactions.deletedAt,
  transferPeerId: transactions.transferPeerId,
  // 거래 목록과 같은 이체 배지(이체 → 계정)를 보여주기 위해서다. 바깥 컬럼은 테이블 이름을 붙여 쓴다(design.md 2.3).
  peerAccountName: sql<string | null>`(select a.name from transactions p join accounts a on a.id = p.account_id where p.id = ${sql.raw('"transactions"."transfer_peer_id"')})`,
};

const touchedOrder = [asc(transactions.date), ascNullsFirst(transactions.time), ascNullsFirst(transactions.seq), asc(transactions.id)];

// 그 계정에서 기간 안 거래를 찾아 지울 수와 손댄 거래를 돌려준다. DB를 바꾸지 않는다.
// 반영 트랜잭션 안에서도 같은 계산을 다시 하므로 트랜잭션도 받는다.
// deleteCount는 기간 안의 거래 수(삭제 표시 포함, 모두 지운다), touched는 그중 손댄 거래(오래된 순)다.
export async function planImport(db: DbOrTx, userId: number, accountId: number, file: ImportData) {
  const where = inPeriod(userId, accountId, file.period);
  const [row] = await db.select({ n: count() }).from(transactions).where(where);
  const touchedRows = await db
    .select(touchedColumns)
    .from(transactions)
    .where(and(where, touched))
    .orderBy(...touchedOrder);
  return { deleteCount: row?.n ?? 0, insertCount: file.transactions.length, touched: touchedRows };
}

export type ImportPlan = Awaited<ReturnType<typeof planImport>>;
export type TouchedTransaction = ImportPlan["touched"][number];

// 이번 반영에서 새로 생긴 보정 거래(4단계 파일 6.1). 덮어쓰기 전에도 있던 보정은 세지 않는다.
export type AdjustmentSummary = { count: number; total: number };

export type ApplyResult =
  | {
      status: "applied";
      accountId: number;
      importId: number;
      insertedCount: number;
      deletedCount: number;
      newAdjustments: AdjustmentSummary;
    }
  | { status: "needs_confirm"; accountId: number; plan: ImportPlan };

// DB 트랜잭션 하나로 기간 안 거래를 모두 지우고 파일의 거래를 넣는다(3단계 파일 5.3).
// 손댄 거래를 다시 계산해 confirmedIds에 없는 것이 있으면 아무것도 바꾸지 않는다(그 사이 손댄 거래가 늘었을 때, 5.2).
// 확인받은 거래가 그 사이 지워져 줄어든 것은 그대로 반영한다.
// accountId 대신 createAccount를 주면 같은 트랜잭션에서 계정을 만들어 반영한다("계정 만들고 올리기", 3단계 파일 3장).
// 반영하다 실패하면 계정도 만들어지지 않는다.
// 지운 거래는 import_undo에 그대로 남겨 이 업로드를 되돌릴 수 있게 하고, 그 계정의 앞 업로드 되돌리기 자료는 지운다(4.3-5).
export async function applyImport(
  db: DbOrTx,
  userId: number,
  args: ({ accountId: number } | { createAccount: AccountInput }) & {
    fileName: string;
    file: ImportData;
    confirmedIds: readonly number[];
  },
): Promise<ApplyResult> {
  const { file } = args;
  return db.transaction(async (tx) => {
    const accountId = "accountId" in args ? args.accountId : await createAccount(tx, userId, args.createAccount);
    // 남의 계정 id면 없는 계정과 같다(4.2-2).
    const account = await getAccount(tx, userId, accountId);
    // 계정 찾기(3장)를 거쳤으면 생기지 않는다.
    if (account.institution !== file.institution) {
      throw new Error(`계정 금융사(${account.institution})와 파일 금융사(${file.institution})가 다릅니다.`);
    }
    // 서버 검사(validate.ts)가 이미 막지만, 시드처럼 직접 만든 파일도 같은 규칙을 지키게 한다(3단계 파일 2장).
    const outside = file.transactions.find((t) => t.date < file.period.start || t.date > file.period.end);
    if (outside) throw new Error(`거래일 ${outside.date}이(가) 기간(${file.period.start} ~ ${file.period.end}) 밖에 있습니다.`);

    const plan = await planImport(tx, userId, accountId, file);
    const confirmed = new Set(args.confirmedIds);
    if (plan.touched.some((t) => !confirmed.has(t.id))) return { status: "needs_confirm", accountId, plan };

    // 덮어쓰기 전의 보정 거래. 같은 날짜·금액의 새 보정이 created_at을 이어받는다(4단계 파일 6.1).
    const previous = await tx
      .select({ date: transactions.date, amount: transactions.amount, createdAt: transactions.createdAt })
      .from(transactions)
      .where(and(inPeriod(userId, accountId, file.period), eq(transactions.kind, "adjustment")))
      .orderBy(asc(transactions.createdAt), asc(transactions.id));

    const now = new Date().toISOString();
    // 반대쪽 이체는 transfer_peer_id가 null이 되어 남는다(외래 키 set null, design.md 1.3-A).
    const deletedRows = await tx.delete(transactions).where(inPeriod(userId, accountId, file.period)).returning();
    const [record] = await tx
      .insert(imports)
      .values({
        userId,
        accountId,
        fileName: args.fileName,
        periodStart: file.period.start,
        periodEnd: file.period.end,
        insertedCount: file.transactions.length,
        deletedCount: plan.deleteCount,
      })
      .returning({ id: imports.id });
    const importId = record.id;

    // 되돌리기는 계정마다 가장 최근 업로드 하나만 된다. 앞 업로드의 자료를 지우고 이번 자료를 남긴다.
    const older = await tx
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.userId, userId), eq(imports.accountId, accountId)));
    await tx.delete(importUndo).where(and(eq(importUndo.userId, userId), inArray(importUndo.importId, older.map((r) => r.id))));
    await tx.insert(importUndo).values({ importId, userId, deletedRows: deletedRows.sort((a, b) => a.id - b.id), appliedAt: now });

    // 보정은 기간 안 거래를 지운 뒤 계산한다. 카드 계정은 잔액이 없어 하지 않는다(4단계 파일 1장, 3.4).
    const adjustments =
      account.kind === "card"
        ? []
        : computeAdjustments({
            startBalance: await getBalanceBefore(tx, userId, accountId, file.period.start),
            openingDate: account.openingDate,
            rows: file.transactions,
          });
    const adjustmentsAt = new Map<number, (typeof adjustments)[number]>(adjustments.map((a) => [a.afterIndex, a]));

    // 저장된 분류가 있는 거래는 반영할 때 붙인다. 남은 미분류는 반영 뒤 classifyPending이 분류한다(5단계 파일 5.1).
    const rules = await loadRules(tx, userId);
    const newAdjustments: AdjustmentSummary = { count: 0, total: 0 };
    const inheritCreatedAt = (date: string, amount: number) => {
      const i = previous.findIndex((p) => p.date === date && p.amount === amount);
      if (i >= 0) return previous.splice(i, 1)[0].createdAt;
      newAdjustments.count++;
      newAdjustments.total += amount;
      return now;
    };

    // 파일 거래와 보정 거래를 합친 순서로 seq를 1부터 매긴다(4단계 파일 3.3).
    const rows: (typeof transactions.$inferInsert)[] = [];
    file.transactions.forEach((t, i) => {
      rows.push({
        userId,
        accountId,
        kind: "normal",
        source: "upload",
        date: t.date,
        time: t.time,
        seq: rows.length + 1,
        amount: t.amount,
        description: t.description,
        method: t.method,
        memo: t.memo,
        cardLabel: t.cardLabel,
        balanceAfter: t.balanceAfter,
        importId,
        ...attachSavedCategory(rules, t),
      });
      const adjustment = adjustmentsAt.get(i);
      if (!adjustment) return;
      rows.push({
        userId,
        accountId,
        kind: "adjustment",
        source: "system",
        date: adjustment.date,
        time: t.time,
        seq: rows.length + 1,
        amount: adjustment.amount,
        description: "잔액 보정",
        balanceAfter: adjustment.balanceAfter,
        importId,
        createdAt: inheritCreatedAt(adjustment.date, adjustment.amount),
      });
    });
    // Postgres 한 문장의 변수 개수 제한(65,535)에 걸리지 않게 나눠 넣는다.
    for (let i = 0; i < rows.length; i += 1_000) await tx.insert(transactions).values(rows.slice(i, i + 1_000));

    return {
      status: "applied",
      accountId,
      importId,
      insertedCount: file.transactions.length,
      deletedCount: plan.deleteCount,
      newAdjustments,
    };
  });
}

export type UndoResult = { status: "undone"; accountId: number; restoredCount: number; removedCount: number } | { status: "needs_confirm"; touched: TouchedTransaction[] };

const NOT_UNDOABLE = "이 업로드는 되돌릴 수 없습니다. 계정마다 가장 최근 업로드 하나만 되돌릴 수 있습니다.";

// 업로드 되돌리기(4.3-5). 그 계정의 가장 최근 업로드이고 되돌리기 자료가 있어야 한다.
// 업로드 뒤에 그 계정의 거래를 손댔으면(수동 입력, 수정, 삭제 표시. 카테고리만 바꾼 것은 빼고) 그 목록을 돌려주고,
// confirmedIds로 모두 확인받아야 되돌린다. 되돌리면 이 업로드로 들어온 거래(보정 포함)를 지우고, 이 업로드가 지운 거래를
// 같은 id와 같은 상태로 다시 넣는다. 반대쪽 이체가 남아 있으면 양쪽 연결도 되살린다. 업로드 뒤 넣은 수동 거래는 그대로 둔다.
// "계정 만들고 올리기"로 만든 계정은 남는다.
export async function undoImport(
  db: DbOrTx,
  userId: number,
  importId: number,
  options: { confirmedIds?: readonly number[] } = {},
): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ id: imports.id, accountId: imports.accountId, deletedRows: importUndo.deletedRows, appliedAt: importUndo.appliedAt })
      .from(imports)
      .leftJoin(importUndo, eq(importUndo.importId, imports.id))
      .where(and(eq(imports.id, importId), eq(imports.userId, userId)));
    if (!record) throw new UserError("업로드 기록을 찾을 수 없습니다. 이미 되돌렸거나 지워졌을 수 있습니다.");
    const [latest] = await tx
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.userId, userId), eq(imports.accountId, record.accountId)))
      .orderBy(desc(imports.id))
      .limit(1);
    if (record.deletedRows == null || record.appliedAt == null || latest?.id !== importId) throw new UserError(NOT_UNDOABLE);
    const { accountId, appliedAt } = record;

    // 업로드 뒤 손댄 거래. 개요 5.2와 같은 기준이라 카테고리만 바꾼 것은 넣지 않는다.
    const touchedRows = await tx
      .select(touchedColumns)
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
          or(
            and(eq(transactions.source, "manual"), gt(transactions.createdAt, appliedAt)),
            gt(transactions.editedAt, appliedAt),
            gt(transactions.deletedAt, appliedAt),
          ),
        ),
      )
      .orderBy(...touchedOrder);
    const confirmed = new Set(options.confirmedIds ?? []);
    if (touchedRows.some((t) => !confirmed.has(t.id))) return { status: "needs_confirm", touched: touchedRows };

    const removed = await tx
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.importId, importId)))
      .returning({ id: transactions.id });

    // 지운 거래를 다시 넣는다. 그사이 지워진 업로드 기록·카테고리를 가리키던 칸은 비운다(외래 키).
    const stored = record.deletedRows as TransactionRow[];
    const restored = stored.filter((r) => r.userId === userId && r.accountId === accountId);
    const liveImports = await existingIds(tx, imports, userId, restored.map((r) => r.importId));
    const liveCategories = await existingIds(tx, categories, userId, restored.map((r) => r.categoryId));
    const restoredIds = new Set(restored.map((r) => r.id));
    const peers = await existingIds(
      tx,
      transactions,
      userId,
      restored.map((r) => r.transferPeerId).filter((id) => id != null && !restoredIds.has(id)),
    );
    const rows = restored.map((r) => ({
      ...r,
      importId: r.importId != null && liveImports.has(r.importId) ? r.importId : null,
      ...(r.categoryId != null && !liveCategories.has(r.categoryId) ? { categoryId: null, categorySource: null } : {}),
      transferPeerId: null,
    }));
    for (let i = 0; i < rows.length; i += 1_000) await tx.insert(transactions).values(rows.slice(i, i + 1_000));
    // 이체 연결은 반대쪽이 남아 있을 때만 양쪽에 되살린다.
    for (const r of restored) {
      const peerId = r.transferPeerId;
      if (peerId == null || !(restoredIds.has(peerId) || peers.has(peerId))) continue;
      await tx
        .update(transactions)
        .set({ transferPeerId: peerId })
        .where(and(eq(transactions.id, r.id), eq(transactions.userId, userId)));
      if (peers.has(peerId)) {
        await tx
          .update(transactions)
          .set({ transferPeerId: r.id })
          .where(and(eq(transactions.id, peerId), eq(transactions.userId, userId)));
      }
    }

    // 업로드 기록을 지우면 되돌리기 자료도 함께 지워진다(cascade).
    await tx.delete(imports).where(and(eq(imports.id, importId), eq(imports.userId, userId)));
    return { status: "undone", accountId, restoredCount: rows.length, removedCount: removed.length };
  });
}

// ids 중 그 사용자의 행으로 아직 있는 것
async function existingIds(
  db: DbOrTx,
  table: typeof imports | typeof categories | typeof transactions,
  userId: number,
  ids: readonly (number | null)[],
): Promise<Set<number>> {
  const wanted = [...new Set(ids.filter((id): id is number => id != null))];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, wanted), eq(table.userId, userId)));
  return new Set(rows.map((r) => r.id));
}
