// 확인용 시드 DB를 새로 만든다(design.md 4.5). 실행: pnpm db:seed
import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, DEFAULT_APP_DB_PATH, DEV_DB_PATH } from "@/db/client";
import { seedDevData } from "@/db/seed";

// 실제로 쓰는 앱 DB에는 넣지 않는다.
if (path.resolve(DEV_DB_PATH) === path.resolve(DEFAULT_APP_DB_PATH)) {
  throw new Error("시드 DB 경로가 앱 DB와 같습니다.");
}

// 매번 같은 상태에서 시작하도록 지우고 새로 만든다. WAL 등 딸린 파일도 함께 지운다.
for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(DEV_DB_PATH + suffix, { force: true });
fs.mkdirSync(path.dirname(DEV_DB_PATH), { recursive: true });

const db = createDb(DEV_DB_PATH);
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
seedDevData(db);
db.$client.close();
console.log(`시드 DB를 만들었습니다: ${path.relative(process.cwd(), DEV_DB_PATH)}`);
