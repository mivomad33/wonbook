// 저장된 분류 찾기와 Claude API 분류(5단계 파일 5장). 규칙·카테고리·거래는 모두 그 사용자의 것만 본다(2.3).
// applyImport가 반영 트랜잭션 안에서 저장된 분류를 붙이고(attachSavedCategory), 반영 뒤 uploadFiles가 classifyPending으로 남은 미분류를 분류한다.
// API에 보내는 키는 분류 한도(quota.ts)에서 받은 만큼만이다(4.4-2).
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, CATEGORY_GROUPS, categories, categoryRules, transactions } from "@/db/schema";
import { OTHER_CATEGORY_NAMES } from "@/lib/category-form";
import { countAll } from "@/lib/sql";
import type { CategoryInfo, Classifier, ClassifyItem } from "./claude";
import { type MatchKey, matchKeyOf } from "./match-key";
import type { ClassifyError } from "./messages";
import { type QuotaOwner, refund, reserve } from "./quota";

export { type Classifier, classifierFromEnv } from "./claude";
export { setTransactionCategory } from "./change";
export { matchKeyOf } from "./match-key";
export { type ClassifyError, classifyErrorMessage, classifyLimitMessage } from "./messages";
export { classifyLimits, type QuotaOwner, todayUsage } from "./quota";

// 한 번에 묻는 키 수(4.1)
export const CLASSIFY_BATCH = 100;
// API에 보내는 거래 내용 길이(4.4-3). 프롬프트를 바꾸려는 긴 문자열을 줄인다.
export const CLASSIFY_TEXT_MAX = 200;

// 자동 분류 대상인 미분류 거래: 업로드 일반 거래(2장). 삭제 표시한 거래는 목록·집계에 안 나오므로 묻지 않는다.
const pendingOf = (userId: number) =>
  and(
    eq(transactions.userId, userId),
    eq(transactions.kind, "normal"),
    eq(transactions.source, "upload"),
    isNull(transactions.categoryId),
    isNull(transactions.deletedAt),
  );

// match_key → category_id. 규칙은 가맹점 수만큼이라 한 번에 읽는다.
export async function loadRules(db: DbOrTx, userId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ matchKey: categoryRules.matchKey, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId));
  return new Map(rows.map((r) => [r.matchKey, r.categoryId]));
}

// 반영할 파일 거래에 붙일 저장된 분류(5.1의 1). 없으면 미분류.
export function attachSavedCategory(rules: Map<string, number>, t: { description: string; method: string | null }) {
  const key = matchKeyOf(t);
  const categoryId = key ? rules.get(key.key) : undefined;
  return categoryId == null ? {} : { categoryId, categorySource: "saved" as const };
}

// 한도 때문에 API에 보내지 않은 키(4.4-2). limited면 화면이 classifyLimitMessage로 안내한다.
export type LimitInfo = { limited: boolean; limitedKeys: number };

export type ClassifyResult = LimitInfo & {
  // 이번에 붙인 수. saved는 그사이 생긴 규칙으로 붙인 것이다.
  saved: number;
  ai: number;
  // 대상 범위에 미분류로 남은 수
  pending: number;
  error: ClassifyError | null;
};

// 분류를 부르는 쪽이 넘기는 값. quota가 null이면 한도를 세지 않는다(시드·이전 명령·테스트).
export type ClassifyOptions = { classify: Classifier | null; quota: QuotaOwner | null; now?: Date };

type PendingRow = {
  id: number;
  description: string;
  method: string | null;
  amount: number;
  accountKind: (typeof accounts.$inferSelect)["kind"];
  institution: (typeof accounts.$inferSelect)["institution"];
};

const accountType = (r: PendingRow): ClassifyItem["account"] =>
  r.accountKind === "card" ? "card" : r.institution === "kis" ? "securities" : "bank";

// 키마다 대표 거래 하나로 보낼 칸을 만든다(4.2).
const toClassifyItem = (id: string, key: MatchKey, first: PendingRow): ClassifyItem => ({
  id,
  description: key.fromMethod ? null : first.description.slice(0, CLASSIFY_TEXT_MAX),
  direction: first.amount > 0 ? "in" : "out",
  method: first.method,
  account: accountType(first),
});

// 대표 거래를 고르는 데 쓰는 칸
const rowColumns = {
  id: transactions.id,
  description: transactions.description,
  method: transactions.method,
  amount: transactions.amount,
  accountKind: accounts.kind,
  institution: accounts.institution,
};

// entries를 묶음으로 나눠 묻는다. 묶음마다 한도에서 키를 받아 받은 만큼만 보내고, 못 받은 키는 보내지 않는다.
// 호출이 실패하면 받은 키를 돌려준다. onAnswers는 묶음마다 답을 반영한다.
async function askInBatches<E extends { key: MatchKey; first: PendingRow }>(
  db: DbOrTx,
  userId: number,
  entries: E[],
  options: ClassifyOptions & { classify: Classifier },
  onAnswers: (batch: E[], items: ClassifyItem[], answers: Map<string, string>) => Promise<void>,
): Promise<LimitInfo & { asked: number; error: ClassifyError | null }> {
  const result = { limited: false, limitedKeys: 0, asked: 0, error: null as ClassifyError | null };
  const now = options.now ?? new Date();
  const categoryInfos = await listCategoryInfos(db, userId);
  for (let start = 0; start < entries.length; start += CLASSIFY_BATCH) {
    let batch = entries.slice(start, start + CLASSIFY_BATCH);
    if (options.quota) {
      const granted = await reserve(db, { ...options.quota, want: batch.length, now });
      if (granted < batch.length) {
        // 한도가 찼으니 남은 키는 모두 보내지 않는다.
        result.limited = true;
        result.limitedKeys = entries.length - start - granted;
        batch = batch.slice(0, granted);
        start = entries.length;
      }
      if (batch.length === 0) break;
    }
    const items = batch.map(({ key, first }, i) => toClassifyItem(String(i + 1), key, first));
    result.asked += batch.length;
    let answers: Map<string, string>;
    try {
      answers = await options.classify(items, categoryInfos);
    } catch (e) {
      // 업로드는 이미 반영됐으므로 막지 않고 이유만 남긴다(5.2). 쓰지 못한 키는 한도에서 되돌린다(4.4-2).
      result.error = { kind: "failed", message: e instanceof Error ? e.message : String(e) };
      if (options.quota) await refund(db, { ...options.quota, now }, batch.length);
      continue;
    }
    await onAnswers(batch, items, answers);
  }
  return result;
}

// 그 사용자의 카테고리 이름 → id. 목록 밖의 답(없는 이름, 남의 카테고리)은 여기서 찾지 못해 미분류로 남는다(4.4-3).
async function categoryIdsByName(db: DbOrTx, userId: number): Promise<Map<string, number>> {
  const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId));
  return new Map(rows.map((c) => [c.name, c.id]));
}

// 미분류 업로드 거래를 분류한다(5.1의 2·3). importIds를 주면 그 업로드의 거래만, 없으면 전체를 분류한다(다시 분류, 5.3).
// classify가 null이면(API 키 없음) 저장된 분류만 붙인다. API가 실패한 묶음은 미분류로 두고 다른 묶음은 계속한다.
// 이미 카테고리가 붙은 거래와 이미 있는 규칙(user 포함)은 바꾸지 않는다.
export async function classifyPending(
  db: DbOrTx,
  userId: number,
  options: ClassifyOptions & { importIds?: readonly number[] },
): Promise<ClassifyResult> {
  const { importIds } = options;
  const result: ClassifyResult = { saved: 0, ai: 0, pending: 0, error: null, limited: false, limitedKeys: 0 };
  if (importIds && importIds.length === 0) return result;
  const scope = and(pendingOf(userId), importIds ? inArray(transactions.importId, [...importIds]) : undefined);

  const rows: PendingRow[] = await db
    .select(rowColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(scope)
    .orderBy(asc(transactions.id));

  // 같은 키는 한 번만 묻는다. 대표 거래는 가장 먼저 넣은 것이다.
  const byKey = new Map<string, { key: MatchKey; ids: number[]; first: PendingRow }>();
  for (const r of rows) {
    const key = matchKeyOf(r);
    if (!key) continue;
    const entry = byKey.get(key.key);
    if (entry) entry.ids.push(r.id);
    else byKey.set(key.key, { key, ids: [r.id], first: r });
  }

  // 아직 미분류인 거래에만 붙인다. 그사이 붙은 거래는 건드리지 않는다.
  const attach = async (tx: DbOrTx, ids: number[], categoryId: number, categorySource: "saved" | "ai") =>
    (
      await tx
        .update(transactions)
        .set({ categoryId, categorySource })
        .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId), isNull(transactions.categoryId)))
        .returning({ id: transactions.id })
    ).length;

  // 그사이 생긴 규칙을 먼저 붙인다(다른 업로드에서 AI로 분류됐거나 사용자가 고친 키).
  await db.transaction(async (tx) => {
    const rules = await loadRules(tx, userId);
    for (const [key, entry] of byKey) {
      const categoryId = rules.get(key);
      if (categoryId == null) continue;
      result.saved += await attach(tx, entry.ids, categoryId, "saved");
      byKey.delete(key);
    }
  });

  const entries = [...byKey.values()];
  if (entries.length > 0 && !options.classify) result.error = { kind: "no_key" };
  if (entries.length > 0 && options.classify) {
    const asked = await askInBatches(db, userId, entries, { ...options, classify: options.classify }, async (batch, items, answers) => {
      await db.transaction(async (tx) => {
        // 기다리는 사이 카테고리가 지워졌을 수 있어 트랜잭션 안에서 다시 읽는다.
        const idByName = await categoryIdsByName(tx, userId);
        const now = new Date().toISOString();
        for (const [i, entry] of batch.entries()) {
          // 응답에 없는 id, 목록 밖의 이름은 미분류로 둔다(4.1).
          const categoryId = idByName.get(answers.get(items[i].id) ?? "");
          if (categoryId == null) continue;
          // 같은 키의 규칙이 그사이 생겼으면 넣지 않고 그 규칙을 따른다(사용자가 고친 분류를 덮어쓰지 않는다).
          const [inserted] = await tx
            .insert(categoryRules)
            .values({ userId, matchKey: entry.key.key, categoryId, source: "ai", updatedAt: now })
            .onConflictDoNothing()
            .returning({ id: categoryRules.id });
          if (inserted) {
            result.ai += await attach(tx, entry.ids, categoryId, "ai");
            continue;
          }
          const [rule] = await tx
            .select({ categoryId: categoryRules.categoryId })
            .from(categoryRules)
            .where(and(eq(categoryRules.userId, userId), eq(categoryRules.matchKey, entry.key.key)));
          if (rule) result.saved += await attach(tx, entry.ids, rule.categoryId, "saved");
        }
      });
    });
    result.error = asked.error;
    result.limited = asked.limited;
    result.limitedKeys = asked.limitedKeys;
  }

  const [left] = await db.select({ n: count() }).from(transactions).where(scope);
  result.pending = left?.n ?? 0;
  return result;
}

// AI에 보낼 카테고리 목록. 묶음 순서(지출 → 수입 → 이동), 묶음 안 순서대로.
export async function listCategoryInfos(db: DbOrTx, userId: number): Promise<CategoryInfo[]> {
  const rows = await db
    .select({ name: categories.name, group: categories.group, sortOrder: categories.sortOrder, id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId));
  const order = (g: CategoryInfo["group"]) => CATEGORY_GROUPS.indexOf(g);
  return rows
    .sort((a, b) => order(a.group) - order(b.group) || a.sortOrder - b.sortOrder || a.id - b.id)
    .map(({ name, group }) => ({ name, group }));
}

// 미분류 업로드 거래 수. 업로드 화면의 "미분류 N건 · 다시 분류"에 쓴다(5.3).
export async function countPending(db: DbOrTx, userId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(transactions).where(pendingOf(userId));
  return row?.n ?? 0;
}

export type CategoryCounts = { saved: number; ai: number; pending: number };

// 업로드마다 분류 결과(6장). 분류할 거래(업로드 일반 거래)만 센다. user는 이번 업로드에서 생기지 않는다.
export async function categoryCountsByImport(db: DbOrTx, userId: number, importIds: readonly number[]): Promise<Map<number, CategoryCounts>> {
  const counts = new Map<number, CategoryCounts>(importIds.map((id) => [id, { saved: 0, ai: 0, pending: 0 }]));
  if (importIds.length === 0) return counts;
  const rows = await db
    .select({ importId: transactions.importId, source: transactions.categorySource, n: countAll() })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.importId, [...importIds]),
        eq(transactions.kind, "normal"),
        eq(transactions.source, "upload"),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.importId, transactions.categorySource);
  for (const r of rows) {
    const c = counts.get(r.importId!);
    if (!c) continue;
    if (r.source === "saved" || r.source === "user") c.saved += r.n;
    else if (r.source === "ai") c.ai += r.n;
    else c.pending += r.n;
  }
  return counts;
}

// "기타"로 분류한 ai 규칙. 카테고리를 추가하면 이 키만 다시 묻는다(8장, 결정 F9).
async function otherAiRules(db: DbOrTx, userId: number) {
  return db
    .select({ matchKey: categoryRules.matchKey, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(and(eq(categoryRules.userId, userId), eq(categoryRules.source, "ai"), inArray(categories.name, [...OTHER_CATEGORY_NAMES])));
}

// 다시 물을 키와 키마다 대표 거래(가장 먼저 넣은 업로드 거래). 거래가 모두 지워진 키는 보낼 칸이 없어 묻지 않는다.
async function otherKeysToAsk(db: DbOrTx, userId: number) {
  const rules = new Map((await otherAiRules(db, userId)).map((r) => [r.matchKey, r.categoryId]));
  const byKey = new Map<string, { key: MatchKey; first: PendingRow }>();
  if (rules.size === 0) return { rules, entries: [] };
  const rows: PendingRow[] = await db
    .select(rowColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, userId), eq(transactions.kind, "normal"), eq(transactions.source, "upload")))
    .orderBy(asc(transactions.id));
  for (const r of rows) {
    const key = matchKeyOf(r);
    if (key && rules.has(key.key) && !byKey.has(key.key)) byKey.set(key.key, { key, first: r });
  }
  return { rules, entries: [...byKey.values()] };
}

// 다시 물을 키 수(reclassifyOthers가 실제로 묻는 키만). 카테고리 화면이 다시 묻기를 권할지 정하는 데 쓴다.
export async function countOtherAiRules(db: DbOrTx, userId: number): Promise<number> {
  return (await otherKeysToAsk(db, userId)).entries.length;
}

export type ReclassifyOthersResult = LimitInfo & {
  // 물은 키 수(대표 거래가 남아 있는 키만 묻는다)
  asked: number;
  // 답이 바뀌어 옮긴 키와 거래 수
  changedKeys: number;
  changedTransactions: number;
  error: ClassifyError | null;
};

// "기타"로 분류한 ai 규칙의 키만 지금 카테고리 목록으로 다시 묻는다(8장, 결정 F9).
// 답이 바뀐 키는 규칙과 그 키의 ai·saved 거래를 새 카테고리로 바꾼다. user 규칙·거래와 다른 카테고리의 키는 건드리지 않는다.
export async function reclassifyOthers(db: DbOrTx, userId: number, options: ClassifyOptions): Promise<ReclassifyOthersResult> {
  const result: ReclassifyOthersResult = { asked: 0, changedKeys: 0, changedTransactions: 0, error: null, limited: false, limitedKeys: 0 };
  const { rules, entries } = await otherKeysToAsk(db, userId);
  if (entries.length === 0) return result;
  if (!options.classify) {
    result.error = { kind: "no_key" };
    return result;
  }

  const asked = await askInBatches(db, userId, entries, { ...options, classify: options.classify }, async (batch, items, answers) => {
    await db.transaction(async (tx) => {
      const idByName = await categoryIdsByName(tx, userId);
      const now = new Date().toISOString();
      // 거래는 키로 찾아야 해서 한 번 읽어 둔다. 삭제 표시한 거래는 바꾸지 않는다(7.1과 같다).
      const candidates = await tx
        .select({ id: transactions.id, description: transactions.description, method: transactions.method, categoryId: transactions.categoryId })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.kind, "normal"),
            eq(transactions.source, "upload"),
            isNull(transactions.deletedAt),
            inArray(transactions.categorySource, ["ai", "saved"]),
          ),
        );
      for (const [i, entry] of batch.entries()) {
        const oldId = rules.get(entry.key.key)!;
        const newId = idByName.get(answers.get(items[i].id) ?? "");
        // 목록 밖의 답이나 그대로 "기타"인 답은 두고 넘어간다.
        if (newId == null || newId === oldId) continue;
        // 기다리는 사이 사용자가 고친 규칙(user)은 바꾸지 않는다.
        const changed = await tx
          .update(categoryRules)
          .set({ categoryId: newId, updatedAt: now })
          .where(
            and(
              eq(categoryRules.userId, userId),
              eq(categoryRules.matchKey, entry.key.key),
              eq(categoryRules.source, "ai"),
              eq(categoryRules.categoryId, oldId),
            ),
          )
          .returning({ id: categoryRules.id });
        if (changed.length === 0) continue;
        const ids = candidates.filter((c) => c.categoryId === oldId && matchKeyOf(c)?.key === entry.key.key).map((c) => c.id);
        result.changedKeys += 1;
        if (ids.length === 0) continue;
        const moved = await tx
          .update(transactions)
          .set({ categoryId: newId })
          .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId), inArray(transactions.categorySource, ["ai", "saved"])))
          .returning({ id: transactions.id });
        result.changedTransactions += moved.length;
      }
    });
  });
  result.asked = asked.asked;
  result.error = asked.error;
  result.limited = asked.limited;
  result.limitedKeys = asked.limitedKeys;
  return result;
}
