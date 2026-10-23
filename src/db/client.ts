import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DEFAULT_APP_DB_PATH = path.join(process.cwd(), "data", "wonbook.db");
// 확인용 시드 DB(design.md 4.5). 실제로 쓰는 앱 DB와 나눈다.
export const DEV_DB_PATH = path.join(process.cwd(), "data", "dev.db");

// 앱이 여는 DB. WONBOOK_DB_PATH로 시드 DB 등 다른 파일을 열 수 있다(design.md 4.5).
export const APP_DB_PATH = process.env.WONBOOK_DB_PATH
  ? path.resolve(process.env.WONBOOK_DB_PATH)
  : DEFAULT_APP_DB_PATH;

// 경로를 받아 DB를 연다. 앱 DB와 테스트의 메모리 DB가 같이 쓴다(design.md 4.2).
export function createDb(filePath: string) {
  const sqlite = new Database(filePath);
  // SQLite는 연결마다 켜야 외래 키 제약과 on delete 동작이 실행된다(design.md 1.1).
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

// db.transaction 안의 tx. 트랜잭션 안에서도 부르는 함수는 둘 다 받는다(3-3 planImport, 3-4 계정 만들고 올리기).
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// 개발 서버가 코드를 다시 불러올 때마다 연결이 늘지 않게 전역에 하나만 둔다.
const globalForDb = globalThis as unknown as { appDb?: Db };

export function getAppDb(): Db {
  if (!globalForDb.appDb) {
    fs.mkdirSync(path.dirname(APP_DB_PATH), { recursive: true });
    globalForDb.appDb = createDb(APP_DB_PATH);
  }
  return globalForDb.appDb;
}
