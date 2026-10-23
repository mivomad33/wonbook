// 사용자가 거래 목록에서 카테고리를 바꾼다(5단계 파일 7.1, design.md 1.3-C).
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { categoryRules, transactions } from "@/db/schema";
import { getCategory } from "@/lib/categories";
import { UserError } from "@/lib/user-error";
import { matchKeyOf } from "./match-key";

// 바꾼 거래와 같은 키라 함께 바꾼 다른 거래 수를 돌려준다. edited_at은 바꾸지 않는다(손댄 거래가 아니다).
// - 업로드 거래: 거래와 그 키의 규칙을 user로 바꾸고, 같은 키의 saved·ai·미분류 거래도 saved로 바꾼다. user 거래는 그대로 둔다.
// - 수동 거래: 그 거래만 user로 바꾼다(2장).
// 규칙과 같은 키 거래는 그 사용자의 것만 본다. 같은 가맹점이라도 다른 사용자에게는 영향이 없다(4.2-2).
export async function setTransactionCategory(db: DbOrTx, userId: number, id: number, categoryId: number): Promise<{ sameKeyCount: number }> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!row) throw new UserError("거래를 찾을 수 없습니다. 이미 지워졌을 수 있습니다.");
  // 이체·보정 거래에는 카테고리를 붙이지 않는다(2장). 화면에서 숨기지만 서버에서도 막는다.
  if (row.kind !== "normal") throw new UserError("이체·보정 거래에는 카테고리를 붙이지 않습니다.");
  if (row.deletedAt) throw new UserError("삭제 표시한 거래는 되살린 뒤 고칠 수 있습니다.");
  await getCategory(db, userId, categoryId);

  const key = row.source === "upload" ? matchKeyOf(row) : null;
  return db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId, categorySource: "user" })
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!key) return { sameKeyCount: 0 };

    const now = new Date().toISOString();
    await tx
      .insert(categoryRules)
      .values({ userId, matchKey: key.key, categoryId, source: "user", updatedAt: now })
      .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.matchKey], set: { categoryId, source: "user", updatedAt: now } });

    // match_key는 저장하지 않으므로 후보를 읽어 키를 다시 만든다. 미분류 거래도 다시 분류를 기다리지 않고 함께 붙인다.
    // 삭제 표시한 거래는 화면에 보이지 않으므로 바꾸지 않는다(바꾼 건수가 보이는 거래와 맞게). 되살린 뒤 다시 올리면 규칙으로 맞춰진다.
    const candidates = await tx
      .select({ id: transactions.id, description: transactions.description, method: transactions.method })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.kind, "normal"),
          eq(transactions.source, "upload"),
          isNull(transactions.deletedAt),
          ne(transactions.id, id),
          or(inArray(transactions.categorySource, ["saved", "ai"]), isNull(transactions.categoryId)),
        ),
      );
    const sameKeyIds = candidates.filter((r) => matchKeyOf(r)?.key === key.key).map((r) => r.id);
    if (sameKeyIds.length === 0) return { sameKeyCount: 0 };
    const changed = await tx
      .update(transactions)
      .set({ categoryId, categorySource: "saved" })
      .where(and(inArray(transactions.id, sameKeyIds), eq(transactions.userId, userId)))
      .returning({ id: transactions.id });
    return { sameKeyCount: changed.length };
  });
}
