// 여러 파일 업로드 한 번의 흐름(3단계 파일 5.1·5.2). 서버 액션은 이 함수를 부르고 revalidatePath만 한다.
// 파일 읽기 → 계정 찾기 → 같은 계좌 파일 검사 → planImport로 반영할지 판단 → (반영할 파일이 있으면) 백업 한 번 → applyImport
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, imports, type AccountKind, type Institution } from "@/db/schema";
import { findAccountByKey } from "@/lib/accounts";
import { type CategoryCounts, categoryCountsByImport, type ClassifyError, type Classifier, classifyPending } from "@/lib/categorize";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { ParseError, parseFile, type ParsedFile } from "@/lib/parsers";
import { UserError } from "@/lib/user-error";
import { normalizeAccountKey } from "./account-key";
import { type AdjustmentSummary, applyImport, planImport, type TouchedTransaction } from "./index";
import { openingFromFile } from "./opening";

export type UploadFileInput = {
  name: string;
  data: Uint8Array;
  // 사용자가 확인한 손댄 거래 id. 처음 올릴 때는 비어 있다.
  confirmedIds: readonly number[];
  // "계정 만들고 올리기"(3단계 파일 3장, 결정 D5): 맞는 계정이 없으면 만들어 반영한다.
  createAccount?: boolean;
};

type FileInfo = {
  fileName: string;
  institution: Institution;
  period: ParsedFile["period"];
};

type AccountRef = { id: number; name: string };

// 맞는 계정이 없을 때 "계정 만들고 올리기"로 만들 계정
export type NewAccountInfo = { name: string; kind: AccountKind; externalKey: string | null };

export type UploadFileResult =
  | (FileInfo & {
      status: "applied";
      account: AccountRef;
      insertedCount: number;
      deletedCount: number;
      createdAccount: boolean;
      newAdjustments: AdjustmentSummary;
      // 이 파일 거래의 분류 결과(5단계 파일 6장)
      categories: CategoryCounts;
    })
  | (FileInfo & { status: "needs_confirm"; account: AccountRef; insertCount: number; deleteCount: number; touched: TouchedTransaction[] })
  | { status: "error"; fileName: string; message: string; institution?: Institution; period?: ParsedFile["period"]; newAccount?: NewAccountInfo };

// classifyError: 반영한 파일에 미분류가 남은 이유(5단계 파일 5.2). 남은 미분류가 없거나 키가 없는 거래뿐이면 null.
export type UploadResult = { ok: true; files: UploadFileResult[]; classifyError: ClassifyError | null } | { ok: false; message: string };

const isCard = (institution: Institution) => institution === "hana_card" || institution === "kb_card";

// 이름은 `하나은행 1234`(계좌번호 끝 4자리)나 `하나카드`. 계정 관리에서 고칠 수 있다(3단계 파일 3장).
export function newAccountInfo(parsed: ParsedFile): NewAccountInfo {
  const label = INSTITUTION_LABELS[parsed.institution];
  if (isCard(parsed.institution)) return { name: label, kind: "card", externalKey: null };
  const key = normalizeAccountKey(parsed.institution, parsed.accountKey);
  return { name: key ? `${label} ${key.slice(-4)}` : label, kind: "asset", externalKey: key };
}

// 읽기에 성공한 파일과 실패한 파일
type Prepared =
  | { input: UploadFileInput; parsed: ParsedFile; account: AccountRef | undefined }
  | { input: UploadFileInput; error: string };

export async function uploadFiles(
  db: Db,
  files: readonly UploadFileInput[],
  // classify: 미분류를 분류할 Claude API. null이면(API 키 없음) 저장된 분류만 붙는다(5단계 파일 5.2).
  options: { password?: string; createBackup: () => string; classify?: Classifier | null },
): Promise<UploadResult> {
  const prepared: Prepared[] = [];
  for (const input of files) {
    try {
      const parsed = await parseFile(input.data, { password: options.password });
      const found = findAccountByKey(db, parsed.institution, parsed.accountKey);
      prepared.push({ input, parsed, account: found && { id: found.id, name: found.name } });
    } catch (e) {
      // 파일 하나가 오류여도 다른 파일은 반영한다(5.1). 그 밖의 오류는 코드 문제라 그대로 던진다.
      if (e instanceof ParseError || e instanceof UserError) prepared.push({ input, error: e.message });
      else throw e;
    }
  }

  // 같은 계좌 파일이 둘 이상이면 아무것도 반영하지 않는다(5.1). 파싱 오류가 난 파일은 계정 찾기 값을 몰라 빠진다.
  const byAccount = new Map<string, string[]>();
  for (const p of prepared) {
    if (!("parsed" in p)) continue;
    const key = `${p.parsed.institution}:${normalizeAccountKey(p.parsed.institution, p.parsed.accountKey) ?? ""}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), p.input.name]);
  }
  const duplicate = [...byAccount.values()].find((names) => names.length > 1);
  if (duplicate) {
    return { ok: false, message: `같은 계좌 파일이 ${duplicate.length}개 있습니다: ${duplicate.join(", ")}. 하나만 골라 다시 올려 주세요.` };
  }

  // 반영할지 먼저 판단하고, 반영할 파일이 있을 때만 백업한다(5.3, 6장).
  const results: (UploadFileResult | undefined)[] = prepared.map((p) => {
    if (!("parsed" in p)) return { status: "error", fileName: p.input.name, message: p.error };
    const info: FileInfo = { fileName: p.input.name, institution: p.parsed.institution, period: p.parsed.period };
    if (!p.account) {
      if (p.input.createAccount) return undefined;
      return { ...info, status: "error", message: "맞는 계정이 없습니다.", newAccount: newAccountInfo(p.parsed) };
    }
    const plan = planImport(db, p.account.id, p.parsed);
    const confirmed = new Set(p.input.confirmedIds);
    if (plan.touched.every((t) => confirmed.has(t.id))) return undefined;
    return {
      ...info,
      status: "needs_confirm",
      account: p.account,
      insertCount: plan.insertCount,
      deleteCount: plan.deleteCount,
      touched: plan.touched,
    };
  });

  let backupPath: string | null = null;
  const importIds = new Map<number, number>();
  prepared.forEach((p, i) => {
    if (results[i] || !("parsed" in p)) return;
    backupPath ??= options.createBackup();
    const info: FileInfo = { fileName: p.input.name, institution: p.parsed.institution, period: p.parsed.period };
    try {
      const applied = applyOne(db, p.input, p.parsed, p.account, backupPath, info);
      results[i] = applied.result;
      if (applied.importId != null) importIds.set(i, applied.importId);
    } catch (e) {
      // 그 사이 계정이 지워졌거나 같은 계정이 먼저 만들어진 경우(UserError). 다른 파일은 계속 반영한다.
      if (e instanceof UserError) results[i] = { ...info, status: "error", message: e.message };
      else throw e;
    }
  });

  // 모든 파일을 반영한 뒤 이번에 반영한 업로드의 미분류만 분류한다. 확인으로 멈춘 파일은 들어가지 않는다(5단계 파일 5.1).
  const classified = await classifyPending(db, { classify: options.classify ?? null, importIds: [...importIds.values()] });
  const counts = categoryCountsByImport(db, [...importIds.values()]);
  for (const [i, importId] of importIds) {
    const r = results[i];
    if (r?.status === "applied") r.categories = counts.get(importId)!;
  }
  return { ok: true, files: results as UploadFileResult[], classifyError: classified.pending > 0 ? classified.error : null };
}

function applyOne(
  db: Db,
  input: UploadFileInput,
  parsed: ParsedFile,
  found: AccountRef | undefined,
  backupPath: string,
  info: FileInfo,
): { result: UploadFileResult; importId?: number } {
  const common = { fileName: input.name, parsed, confirmedIds: input.confirmedIds, backupPath };
  // 맞는 계정이 없으면 반영과 같은 트랜잭션에서 만든다. 반영하다 실패하면 빈 계정이 남지 않는다.
  const created = newAccountInfo(parsed);
  const applied = found
    ? applyImport(db, { ...common, accountId: found.id })
    : applyImport(db, { ...common, createAccount: { ...created, institution: parsed.institution, ...openingFromFile(parsed) } });
  const account = found ?? { id: applied.accountId, name: created.name };
  if (applied.status === "applied") {
    return {
      importId: applied.importId,
      result: {
        ...info,
        status: "applied",
        account,
        insertedCount: applied.insertedCount,
        deletedCount: applied.deletedCount,
        createdAccount: !found,
        newAdjustments: applied.newAdjustments,
        // 분류를 마친 뒤 uploadFiles가 채운다.
        categories: { saved: 0, ai: 0, pending: 0 },
      },
    };
  }
  // 백업한 뒤 그 사이 손댄 거래가 늘었으면 다시 묻는다. 백업만 남는데 해가 없다(5.3).
  return {
    result: {
      ...info,
      status: "needs_confirm",
      account,
      insertCount: applied.plan.insertCount,
      deleteCount: applied.plan.deleteCount,
      touched: applied.plan.touched,
    },
  };
}

// 업로드 화면의 최근 업로드 기록(3단계 파일 7.1)
export function listRecentImports(db: Db, limit = 20) {
  return db
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
    })
    .from(imports)
    .innerJoin(accounts, eq(accounts.id, imports.accountId))
    .orderBy(desc(imports.createdAt), desc(imports.id))
    .limit(limit)
    .all();
}

// 사이드바의 마지막 업로드 시각(3단계 파일 7.3). 기록이 없으면 null.
export function lastImportAt(db: Db): string | null {
  return db.get<{ at: string | null }>(sql`select max(created_at) as at from imports`)?.at ?? null;
}
