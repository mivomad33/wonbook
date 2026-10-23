// 여러 파일 업로드 한 번의 흐름(3단계 파일 5.1·5.2, 4.3). 서버 동작은 이 함수를 부르고 revalidatePath만 한다.
// 파일은 브라우저가 읽어 UploadRequestFile로 보낸다. 받은 값 검사 → 계정 찾기 → 같은 계좌 파일 검사 → planImport로 반영할지 판단 → applyImport
import { desc, eq, max } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, importUndo, imports, type AccountKind, type Institution } from "@/db/schema";
import { findAccountByKey } from "@/lib/accounts";
import {
  type CategoryCounts,
  categoryCountsByImport,
  type ClassifyError,
  type ClassifyOptions,
  classifyPending,
  type LimitInfo,
} from "@/lib/categorize";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { UserError } from "@/lib/user-error";
import { type AdjustmentSummary, applyImport, planImport, type TouchedTransaction } from "./index";
import { openingFromFile } from "./opening";
import type { UploadedFile, UploadRequestFile } from "./payload";
import { parseUploadRequest } from "./validate";

type FileInfo = {
  fileName: string;
  institution: Institution;
  period: UploadedFile["period"];
};

type AccountRef = { id: number; name: string };

// 맞는 계정이 없을 때 "계정 만들고 올리기"로 만들 계정. 계좌번호는 끝 4자리만 보인다.
export type NewAccountInfo = { name: string; kind: AccountKind; accountKeyLast4: string | null };

export type UploadFileResult =
  | (FileInfo & {
      status: "applied";
      account: AccountRef;
      importId: number;
      insertedCount: number;
      deletedCount: number;
      createdAccount: boolean;
      newAdjustments: AdjustmentSummary;
      // 이 파일 거래의 분류 결과(5단계 파일 6장)
      categories: CategoryCounts;
    })
  | (FileInfo & { status: "needs_confirm"; account: AccountRef; insertCount: number; deleteCount: number; touched: TouchedTransaction[] })
  | { status: "error"; fileName: string; message: string; institution?: Institution; period?: UploadedFile["period"]; newAccount?: NewAccountInfo };

// classifyError: 반영한 파일에 미분류가 남은 이유(5단계 파일 5.2). 남은 미분류가 없거나 키가 없는 거래뿐이면 null.
// classifyLimit: 분류 한도 때문에 API에 보내지 않은 키(4.4-2). limited면 화면이 classifyLimitMessage로 안내한다.
export type UploadResult =
  | { ok: true; files: UploadFileResult[]; classifyError: ClassifyError | null; classifyLimit: LimitInfo }
  | { ok: false; message: string };

const isCard = (institution: Institution) => institution === "hana_card" || institution === "kb_card";

// 이름은 `하나은행 1234`(계좌번호 끝 4자리)나 `하나카드`. 계정 관리에서 고칠 수 있다(3단계 파일 3장).
export function newAccountInfo(file: Pick<UploadedFile, "institution" | "accountKey">): NewAccountInfo {
  const label = INSTITUTION_LABELS[file.institution];
  if (isCard(file.institution)) return { name: label, kind: "card", accountKeyLast4: null };
  const last4 = file.accountKey?.last4 ?? null;
  return { name: last4 ? `${label} ${last4}` : label, kind: "asset", accountKeyLast4: last4 };
}

const infoOf = (f: UploadRequestFile): FileInfo => ({ fileName: f.fileName, institution: f.institution, period: f.period });

// files는 브라우저가 보낸 값 그대로 받아 여기서 검사한다(4.3-2). 맞지 않으면 UserError를 던지고 아무것도 반영하지 않는다.
// options.classify: 미분류를 분류할 Claude API. null이면(API 키 없음) 저장된 분류만 붙는다(5단계 파일 5.2).
// options.quota: 분류 한도를 세는 사용자(4.4-2).
export async function uploadFiles(db: DbOrTx, userId: number, input: unknown, options: ClassifyOptions): Promise<UploadResult> {
  const files = parseUploadRequest(input);

  // 같은 계좌 파일이 둘 이상이면 아무것도 반영하지 않는다(5.1).
  const byAccount = new Map<string, string[]>();
  for (const f of files) {
    const key = `${f.institution}:${f.accountKey?.digest ?? ""}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), f.fileName]);
  }
  const duplicate = [...byAccount.values()].find((names) => names.length > 1);
  if (duplicate) {
    return { ok: false, message: `같은 계좌 파일이 ${duplicate.length}개 있습니다: ${duplicate.join(", ")}. 하나만 골라 다시 올려 주세요.` };
  }

  // 계정을 찾고 반영할지 먼저 판단한다. 반영하지 않을 파일은 결과를 바로 채운다(5.3).
  const found: (AccountRef | undefined)[] = [];
  const results: (UploadFileResult | undefined)[] = [];
  for (const f of files) {
    const account = await findAccountByKey(db, userId, f.institution, f.accountKey?.digest ?? null);
    const ref = account && { id: account.id, name: account.name };
    found.push(ref);
    if (!ref) {
      results.push(f.createAccount ? undefined : { ...infoOf(f), status: "error", message: "맞는 계정이 없습니다.", newAccount: newAccountInfo(f) });
      continue;
    }
    const plan = await planImport(db, userId, ref.id, f);
    const confirmed = new Set(f.confirmedIds);
    results.push(
      plan.touched.every((t) => confirmed.has(t.id))
        ? undefined
        : { ...infoOf(f), status: "needs_confirm", account: ref, insertCount: plan.insertCount, deleteCount: plan.deleteCount, touched: plan.touched },
    );
  }

  const importIds = new Map<number, number>();
  for (const [i, f] of files.entries()) {
    if (results[i]) continue;
    try {
      const applied = await applyOne(db, userId, f, found[i]);
      results[i] = applied;
      if (applied.status === "applied") importIds.set(i, applied.importId);
    } catch (e) {
      // 그 사이 계정이 지워졌거나 같은 계정이 먼저 만들어진 경우(UserError). 다른 파일은 계속 반영한다.
      if (e instanceof UserError) results[i] = { ...infoOf(f), status: "error", message: e.message };
      else throw e;
    }
  }

  // 모든 파일을 반영한 뒤 이번에 반영한 업로드의 미분류만 분류한다. 확인으로 멈춘 파일은 들어가지 않는다(5단계 파일 5.1).
  const classified = await classifyPending(db, userId, { ...options, importIds: [...importIds.values()] });
  const counts = await categoryCountsByImport(db, userId, [...importIds.values()]);
  for (const [i, importId] of importIds) {
    const r = results[i];
    if (r?.status === "applied") r.categories = counts.get(importId)!;
  }
  return {
    ok: true,
    files: results as UploadFileResult[],
    classifyError: classified.pending > 0 ? classified.error : null,
    classifyLimit: { limited: classified.limited, limitedKeys: classified.limitedKeys },
  };
}

async function applyOne(db: DbOrTx, userId: number, f: UploadRequestFile, found: AccountRef | undefined): Promise<UploadFileResult> {
  const common = { fileName: f.fileName, file: f, confirmedIds: f.confirmedIds };
  // 맞는 계정이 없으면 반영과 같은 트랜잭션에서 만든다. 반영하다 실패하면 빈 계정이 남지 않는다.
  const created = newAccountInfo(f);
  const applied = found
    ? await applyImport(db, userId, { ...common, accountId: found.id })
    : await applyImport(db, userId, {
        ...common,
        createAccount: { name: created.name, kind: created.kind, institution: f.institution, accountKey: f.accountKey, ...openingFromFile(f) },
      });
  const account = found ?? { id: applied.accountId, name: created.name };
  if (applied.status === "applied") {
    return {
      ...infoOf(f),
      status: "applied",
      account,
      importId: applied.importId,
      insertedCount: applied.insertedCount,
      deletedCount: applied.deletedCount,
      createdAccount: !found,
      newAdjustments: applied.newAdjustments,
      // 분류를 마친 뒤 uploadFiles가 채운다.
      categories: { saved: 0, ai: 0, pending: 0 },
    };
  }
  // 판단한 뒤 그 사이 손댄 거래가 늘었으면 다시 묻는다(5.3).
  return {
    ...infoOf(f),
    status: "needs_confirm",
    account,
    insertCount: applied.plan.insertCount,
    deleteCount: applied.plan.deleteCount,
    touched: applied.plan.touched,
  };
}

// 업로드 화면의 최근 업로드 기록(3단계 파일 7.1). undoable은 되돌리기 자료가 있는지다(계정마다 가장 최근 업로드, 4.3-5).
export async function listRecentImports(db: DbOrTx, userId: number, limit = 20) {
  const rows = await db
    .select({
      id: imports.id,
      createdAt: imports.createdAt,
      fileName: imports.fileName,
      accountId: imports.accountId,
      accountName: accounts.name,
      periodStart: imports.periodStart,
      periodEnd: imports.periodEnd,
      insertedCount: imports.insertedCount,
      deletedCount: imports.deletedCount,
      undoId: importUndo.importId,
    })
    .from(imports)
    .innerJoin(accounts, eq(accounts.id, imports.accountId))
    .leftJoin(importUndo, eq(importUndo.importId, imports.id))
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt), desc(imports.id))
    .limit(limit);
  return rows.map(({ undoId, ...r }) => ({ ...r, undoable: undoId != null }));
}

export type RecentImport = Awaited<ReturnType<typeof listRecentImports>>[number];

// 사이드바의 마지막 업로드 시각(3단계 파일 7.3). 기록이 없으면 null.
export async function lastImportAt(db: DbOrTx, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ at: max(imports.createdAt) })
    .from(imports)
    .where(eq(imports.userId, userId));
  return row?.at ?? null;
}
