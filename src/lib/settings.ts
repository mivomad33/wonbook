// settings 테이블 읽기·쓰기(design.md 1.2 settings). 단계마다 생기는 설정 값을 키 하나에 JSON으로 둔다. 사용자별이다(4.2-4).
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { settings } from "@/db/schema";

// 지금 쓰는 키. 새 키는 design.md 1.2 settings에도 적는다.
export type SettingKey = "adjustment_notice_dismissed_at";

export async function getSetting<T>(db: DbOrTx, userId: number, key: SettingKey): Promise<T | undefined> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)));
  return row?.value as T | undefined;
}

export async function setSetting(db: DbOrTx, userId: number, key: SettingKey, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } });
}
