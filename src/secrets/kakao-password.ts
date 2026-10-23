// 카카오뱅크 파일 암호 저장(4.3-4). 사용자마다 서버 키(PASSWORD_ENCRYPTION_KEY)로 AES-256-GCM 암호화해 users.kakao_password_enc에 둔다.
// 키는 DB에 두지 않는다. 키가 바뀌거나 값이 깨지면 복호화하지 않고 null을 돌려준다(화면이 다시 입력을 받는다).
// 저장 형식: "v1." + base64url(12바이트 IV ‖ 암호문 ‖ 16바이트 태그)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { users } from "@/db/schema";

export const KAKAO_PASSWORD_MAX = 64;
const PREFIX = "v1.";

function keyBytes(key = process.env.PASSWORD_ENCRYPTION_KEY): Buffer {
  if (!key) throw new Error("PASSWORD_ENCRYPTION_KEY가 없습니다");
  // 길이에 상관없이 32바이트 키로 맞춘다(환경 변수는 base64 32바이트다).
  return createHash("sha256").update(key).digest();
}

export function encryptPassword(plain: string, key?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, body, c.getAuthTag()]).toString("base64url");
}

export function decryptPassword(stored: string, key?: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
    const d = createDecipheriv("aes-256-gcm", keyBytes(key), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function saveKakaoPassword(db: DbOrTx, userId: number, plain: string): Promise<void> {
  if (plain.length === 0 || plain.length > KAKAO_PASSWORD_MAX) throw new RangeError(`암호는 1~${KAKAO_PASSWORD_MAX}자입니다`);
  await db.update(users).set({ kakaoPasswordEnc: encryptPassword(plain) }).where(and(eq(users.id, userId), eq(users.isDemo, false)));
}

export async function clearKakaoPassword(db: DbOrTx, userId: number): Promise<void> {
  await db.update(users).set({ kakaoPasswordEnc: null }).where(eq(users.id, userId));
}

/** 그 사용자의 저장된 암호. 없거나 복호화되지 않으면 null이다. 그 사용자의 업로드 화면에만 넘긴다. */
export async function loadKakaoPassword(db: DbOrTx, userId: number): Promise<string | null> {
  const [row] = await db.select({ enc: users.kakaoPasswordEnc }).from(users).where(eq(users.id, userId));
  return row?.enc ? decryptPassword(row.enc) : null;
}

export async function hasKakaoPassword(db: DbOrTx, userId: number): Promise<boolean> {
  const [row] = await db.select({ enc: users.kakaoPasswordEnc }).from(users).where(eq(users.id, userId));
  return row?.enc != null;
}
