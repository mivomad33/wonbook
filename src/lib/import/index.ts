// 기간 덮어쓰기와 손댄 거래 확인(3단계 파일 5.3, design.md 1.4).
// 서버 액션은 파일 읽기 → 계정 찾기 → planImport → (반영할 파일이 있으면) 백업 → applyImport 순서로 부른다.
import { and, asc, between, count, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { accounts, imports, transactions } from "@/db/schema";
import type { AccountInput } from "@/lib/account-form";
import { createAccount } from "@/lib/accounts";
import { computeAdjustments, getBalanceBefore } from "@/lib/balance";
import { attachSavedCategory, loadRules } from "@/lib/categorize";
import type { ParsedFile } from "@/lib/parsers";
import { UserError } from "@/lib/user-error";

export { normalizeAccountKey } from "./account-key";
export { openingFromFile } from "./opening";

// 사용자가 손댄 거래: 수동, 수정함, 삭제 표시(design.md 1.2 transactions)
const touched = or(eq(transactions.source, "manual"), isNotNull(transactions.editedAt), isNotNull(transactions.deletedAt));

const inPeriod = (accountId: number, period: ParsedFile["period"]) =>
  and(eq(transactions.accountId, accountId), between(transactions.date, period.start, period.end));

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

// 그 계정에서 기간 안 거래를 찾아 지울 수와 손댄 거래를 돌려준다. DB를 바꾸지 않는다.
// 반영 트랜잭션 안에서도 같은 계산을 다시 하므로 트랜잭션도 받는다.
// deleteCount는 기간 안의 거래 수(삭제 표시 포함, 모두 지운다), touched는 그중 손댄 거래(오래된 순)다.
export function planImport(db: DbOrTx, accountId: number, parsed: ParsedFile) {
  const where = inPeriod(accountId, parsed.period);
  const deleteCount = db.select({ n: count() }).from(transactions).where(where).get()?.n ?? 0;
  const touchedRows = db
    .select(touchedColumns)
    .from(transactions)
    .where(and(where, touched))
    .orderBy(asc(transactions.date), asc(transactions.time), asc(transactions.seq), asc(transactions.id))
    .all();
  return { deleteCount, insertCount: parsed.transactions.length, touched: touchedRows };
}

export type ImportPlan = ReturnType<typeof planImport>;
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
export function applyImport(
  db: Db,
  args: ({ accountId: number } | { createAccount: AccountInput }) & {
    fileName: string;
    parsed: ParsedFile;
    confirmedIds: readonly number[];
    backupPath: string | null;
  },
): ApplyResult {
  const { parsed } = args;
  return db.transaction((tx) => {
    const accountId = "accountId" in args ? args.accountId : createAccount(tx, args.createAccount);
    const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) throw new UserError("계정을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.");
    // 계정 찾기(3장)를 거쳤으면 생기지 않는다.
    if (account.institution !== parsed.institution) {
      throw new Error(`계정 금융사(${account.institution})와 파일 금융사(${parsed.institution})가 다릅니다.`);
    }
    // 파서가 이미 막지만, 시드처럼 직접 만든 파일도 같은 규칙을 지키게 한다(3단계 파일 2장).
    const outside = parsed.transactions.find((t) => t.date < parsed.period.start || t.date > parsed.period.end);
    if (outside) throw new Error(`거래일 ${outside.date}이(가) 기간(${parsed.period.start} ~ ${parsed.period.end}) 밖에 있습니다.`);

    const plan = planImport(tx, accountId, parsed);
    const confirmed = new Set(args.confirmedIds);
    if (plan.touched.some((t) => !confirmed.has(t.id))) return { status: "needs_confirm", accountId, plan };

    // 덮어쓰기 전의 보정 거래. 같은 날짜·금액의 새 보정이 created_at을 이어받는다(4단계 파일 6.1).
    const previous = tx
      .select({ date: transactions.date, amount: transactions.amount, createdAt: transactions.createdAt })
      .from(transactions)
      .where(and(inPeriod(accountId, parsed.period), eq(transactions.kind, "adjustment")))
      .orderBy(asc(transactions.createdAt), asc(transactions.id))
      .all();

    // 반대쪽 이체는 transfer_peer_id가 null이 되어 남는다(외래 키 set null, design.md 1.3-A).
    tx.delete(transactions).where(inPeriod(accountId, parsed.period)).run();
    const importId = tx
      .insert(imports)
      .values({
        accountId,
        fileName: args.fileName,
        periodStart: parsed.period.start,
        periodEnd: parsed.period.end,
        insertedCount: parsed.transactions.length,
        deletedCount: plan.deleteCount,
        backupPath: args.backupPath,
      })
      .returning({ id: imports.id })
      .get().id;

    // 보정은 기간 안 거래를 지운 뒤 계산한다. 카드 계정은 잔액이 없어 하지 않는다(4단계 파일 1장, 3.4).
    const adjustments =
      account.kind === "card"
        ? []
        : computeAdjustments({
            startBalance: getBalanceBefore(tx, accountId, parsed.period.start),
            openingDate: account.openingDate,
            rows: parsed.transactions,
          });
    const adjustmentsAt = new Map<number, (typeof adjustments)[number]>(adjustments.map((a) => [a.afterIndex, a]));

    // 저장된 분류가 있는 거래는 반영할 때 붙인다. 남은 미분류는 반영 뒤 classifyPending이 분류한다(5단계 파일 5.1).
    const rules = loadRules(tx);
    const now = new Date().toISOString();
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
    parsed.transactions.forEach((t, i) => {
      rows.push({
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
        raw: t.raw,
        importId,
        ...attachSavedCategory(rules, t),
      });
      const adjustment = adjustmentsAt.get(i);
      if (!adjustment) return;
      rows.push({
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
    // SQLite 한 문장의 변수 개수 제한에 걸리지 않게 나눠 넣는다.
    for (let i = 0; i < rows.length; i += 200) tx.insert(transactions).values(rows.slice(i, i + 200)).run();

    return {
      status: "applied",
      accountId,
      importId,
      insertedCount: parsed.transactions.length,
      deletedCount: plan.deleteCount,
      newAdjustments,
    };
  });
}
