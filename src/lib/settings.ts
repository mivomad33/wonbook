// settings 테이블 읽기·쓰기(design.md 1.2 settings). 단계마다 생기는 설정 값을 키 하나에 JSON으로 둔다.
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { settings } from "@/db/schema";

// 지금 쓰는 키. 새 키는 design.md 1.2 settings에도 적는다.
export type SettingKey = "adjustment_notice_dismissed_at";

export function getSetting<T>(db: DbOrTx, key: SettingKey): T | undefined {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value as T | undefined;
}

export function setSetting(db: DbOrTx, key: SettingKey, value: unknown) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
