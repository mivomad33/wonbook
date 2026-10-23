// 나눠 보낸 업로드 조각 모으기(4.3-2). 한 요청은 Vercel 본문 한도(4.5MB)보다 작아야 해서,
// 브라우저가 업로드 값(JSON 글)을 조각으로 나눠 stagePart로 보내고 takeStaged로 한 번에 꺼내 반영한다.
// 조각은 그 사용자의 것만 꺼낸다. 꺼내면 지우고, 한 시간 넘게 남은 조각은 그때 함께 지운다.
import { and, asc, eq, lt } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { uploadStaging } from "@/db/schema";
import { UserError } from "@/lib/user-error";
import { MAX_PART_BYTES, MAX_PARTS, utf8Bytes } from "./split";

export { MAX_PART_BYTES, MAX_PARTS, splitIntoParts } from "./split";
const STALE_MS = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function stagePart(db: DbOrTx, userId: number, token: string, part: number, body: string): Promise<void> {
  if (!TOKEN.test(token) || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS) throw new UserError("업로드 조각이 올바르지 않습니다. 다시 올려 주세요.");
  if (utf8Bytes(body) > MAX_PART_BYTES) throw new UserError("업로드 조각이 너무 큽니다. 다시 올려 주세요.");
  await db
    .insert(uploadStaging)
    .values({ userId, token, part, body })
    .onConflictDoUpdate({ target: [uploadStaging.userId, uploadStaging.token, uploadStaging.part], set: { body } });
}

/** 조각을 순서대로 이어 JSON으로 읽고 지운다. 조각이 빠졌거나 JSON이 아니면 UserError다. */
export async function takeStaged(db: DbOrTx, userId: number, token: string, total: number, now = new Date()): Promise<unknown> {
  if (!TOKEN.test(token) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS) throw new UserError("업로드 조각이 올바르지 않습니다. 다시 올려 주세요.");
  const rows = await db
    .select({ part: uploadStaging.part, body: uploadStaging.body })
    .from(uploadStaging)
    .where(and(eq(uploadStaging.userId, userId), eq(uploadStaging.token, token)))
    .orderBy(asc(uploadStaging.part));
  await db.delete(uploadStaging).where(and(eq(uploadStaging.userId, userId), eq(uploadStaging.token, token)));
  await db.delete(uploadStaging).where(and(eq(uploadStaging.userId, userId), lt(uploadStaging.createdAt, new Date(now.getTime() - STALE_MS))));
  if (rows.length !== total || rows.some((r, i) => r.part !== i)) throw new UserError("업로드 조각이 빠졌습니다. 다시 올려 주세요.");
  try {
    return JSON.parse(rows.map((r) => r.body).join(""));
  } catch {
    throw new UserError("업로드 값을 읽을 수 없습니다. 다시 올려 주세요.");
  }
}
