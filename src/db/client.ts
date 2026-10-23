import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

type Schema = typeof schema;

// 앱(node-postgres)과 테스트(PGlite)가 같이 쓰는 DB 타입. 가계부 로직은 이 타입만 받는다.
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
// db.transaction 안의 tx. 트랜잭션 안에서도 부르는 함수는 둘 다 받는다(3-3 planImport, 3-4 계정 만들고 올리기).
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbOrTx = Db | Tx;

export function openDb(url: string, max = 5): { db: NodePgDatabase<Schema>; pool: Pool } {
  const pool = new Pool({ connectionString: url.replace("sslmode=require", "sslmode=verify-full"), max, idleTimeoutMillis: 10_000 });
  // 쉬던 연결이 끊긴 것을 알려 주는 오류로 프로세스가 죽지 않게 한다. 다음 요청은 새 연결을 쓴다.
  pool.on("error", (e) => console.error(`[db] 연결 오류: ${e.name}`));
  return { db: drizzle(pool, { schema }), pool };
}

// 앱의 DB 연결. 처음 쓸 때 연다(빌드 중 정적 페이지는 DB를 쓰지 않는다). 개발 서버의 핫 리로드마다 연결이 늘지 않게 하나만 둔다.
const g = globalThis as unknown as { wonbookDb?: NodePgDatabase<Schema> };

export function getAppDb(): Db {
  if (!g.wonbookDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL이 없습니다");
    g.wonbookDb = openDb(url).db;
  }
  return g.wonbookDb as unknown as Db;
}

export type { NodePgQueryResultHKT };
