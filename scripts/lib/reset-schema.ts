// 원격 DB의 스키마를 지우고 마이그레이션을 처음부터 적용한다. 개발·테스트 DB 초기화에 쓴다(운영 DB는 거부한다).
// Neon의 부모에서 다시 초기화(reset from parent)는 쓰지 않는다. dev·test의 부모가 production이라 운영 데이터가 복사된다.
import { Client } from "pg";
import { migrateDb } from "@/db/migrate";

export async function resetSchema(url: string): Promise<void> {
  const prod = [process.env.PROD_DATABASE_URL, process.env.PROD_DATABASE_URL_UNPOOLED].filter(Boolean).map((u) => new URL(u!).hostname);
  if (prod.includes(new URL(url).hostname)) throw new Error("운영 DB는 초기화하지 않습니다");
  const c = new Client({ connectionString: url.replace("sslmode=require", "sslmode=verify-full") });
  await c.connect();
  try {
    await c.query("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;");
  } finally {
    await c.end();
  }
  await migrateDb(url);
}
