// 사용자가 거래 목록에서 카테고리를 바꾼다(5단계 파일 7.1, design.md 1.3-C).
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categoryRules, transactions } from "@/db/schema";
import { getCategory } from "@/lib/categories";
import { UserError } from "@/lib/user-error";
import { matchKeyOf } from "./match-key";

// 바꾼 거래와 같은 키라 함께 바꾼 다른 거래 수를 돌려준다. edited_at은 바꾸지 않는다(손댄 거래가 아니다).
// - 업로드 거래: 거래와 그 키의 규칙을 user로 바꾸고, 같은 키의 saved·ai·미분류 거래도 saved로 바꾼다. user 거래는 그대로 둔다.
// - 수동 거래: 그 거래만 user로 바꾼다(2장).
export function setTransactionCategory(db: Db, id: number, categoryId: number): { sameKeyCount: number } {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw new UserError("거래를 찾을 수 없습니다. 이미 지워졌을 수 있습니다.");
  // 이체·보정 거래에는 카테고리를 붙이지 않는다(2장). 화면에서 숨기지만 서버에서도 막는다.
  if (row.kind !== "normal") throw new UserError("이체·보정 거래에는 카테고리를 붙이지 않습니다.");
  if (row.deletedAt) throw new UserError("삭제 표시한 거래는 되살린 뒤 고칠 수 있습니다.");
  getCategory(db, categoryId);

  const key = row.source === "upload" ? matchKeyOf(row) : null;
  return db.transaction((tx) => {
    tx.update(transactions).set({ categoryId, categorySource: "user" }).where(eq(transactions.id, id)).run();
    if (!key) return { sameKeyCount: 0 };

    const now = new Date().toISOString();
    tx.insert(categoryRules)
      .values({ matchKey: key.key, categoryId, source: "user", updatedAt: now })
      .onConflictDoUpdate({ target: categoryRules.matchKey, set: { categoryId, source: "user", updatedAt: now } })
      .run();

    // match_key는 저장하지 않으므로 후보를 읽어 키를 다시 만든다. 미분류 거래도 다시 분류를 기다리지 않고 함께 붙인다.
    // 삭제 표시한 거래는 화면에 보이지 않으므로 바꾸지 않는다(바꾼 건수가 보이는 거래와 맞게). 되살린 뒤 다시 올리면 규칙으로 맞춰진다.
    const sameKeyIds = tx
      .select({ id: transactions.id, description: transactions.description, method: transactions.method })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, "normal"),
          eq(transactions.source, "upload"),
          isNull(transactions.deletedAt),
          ne(transactions.id, id),
          or(inArray(transactions.categorySource, ["saved", "ai"]), isNull(transactions.categoryId)),
        ),
      )
      .all()
      .filter((r) => matchKeyOf(r)?.key === key.key)
      .map((r) => r.id);
    if (sameKeyIds.length === 0) return { sameKeyCount: 0 };
    const sameKeyCount = tx
      .update(transactions)
      .set({ categoryId, categorySource: "saved" })
      .where(inArray(transactions.id, sameKeyIds))
      .run().changes;
    return { sameKeyCount };
  });
}
