// 저장용 계좌 해시(4.7-1). 브라우저가 보낸 키 없는 해시에 서버 비밀 키(ACCOUNT_HASH_KEY)를 더한다.
// DB만으로는 계좌번호를 되살리거나 같은 해시를 만들 수 없다.
import { createHmac } from "node:crypto";
import { isDigest } from "./account-key";

export function accountKeyHash(digest: string, key = process.env.ACCOUNT_HASH_KEY): string {
  if (!key) throw new Error("ACCOUNT_HASH_KEY가 없습니다");
  if (!isDigest(digest)) throw new Error("계좌 식별값 형식이 맞지 않습니다");
  return createHmac("sha256", key).update(digest).digest("hex");
}
