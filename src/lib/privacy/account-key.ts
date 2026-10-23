// 계좌 식별값(4.3-1, 4.7-1). 계좌번호는 그대로 서버로 보내거나 저장하지 않는다.
// 브라우저(업로드·계정 폼)는 정규화한 번호의 SHA-256(키 없는 해시)과 끝 4자리만 보낸다.
// 서버는 그 값에 비밀 키를 더해 저장용 해시를 만든다(account-key-server.ts). 이전 명령도 같은 순서로 만든다.
// 브라우저와 Node 모두에 있는 Web Crypto만 쓴다.
import { z } from "zod";
import type { Institution } from "@/db/schema";
import { normalizeAccountKey } from "@/lib/import/account-key";

export type AccountKeyRef = { digest: string; last4: string };

async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 파일·폼의 계좌번호를 보낼 값으로 바꾼다. 카드사처럼 식별값을 쓰지 않으면 null이다.
export async function toAccountKeyRef(institution: Institution | null, key: string | null): Promise<AccountKeyRef | null> {
  const normalized = normalizeAccountKey(institution, key);
  if (!normalized) return null;
  return { digest: await sha256Hex(`${institution ?? ""}:${normalized}`), last4: normalized.slice(-4) };
}

export const isDigest = (s: string) => /^[0-9a-f]{64}$/.test(s);

// 서버가 받는 계좌 식별값 검사(업로드·계정 폼). 끝 4자리는 정규화한 번호의 끝이라 숫자 1~4자리다.
export const accountKeyRefSchema = z.object({
  digest: z.string().refine(isDigest, "계좌 식별값 형식이 맞지 않습니다."),
  last4: z.string().regex(/^\d{1,4}$/, "계좌 식별값 형식이 맞지 않습니다."),
});
