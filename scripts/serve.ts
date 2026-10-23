// 운영 서버(design.md 2.4). 실행: pnpm serve (먼저 pnpm build)
// next start 대신 Next를 직접 띄워, 요청이 WONBOOK_IDLE_MINUTES 동안 없으면 스스로 끈다.
// 쓸 때만 켜고(Dock의 Wonbook.app) 안 쓸 때 메모리를 쓰지 않기 위해서다. 이 맥에서만 접속을 받는다.
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

// 포트·자동 종료 시간도 .env.local에서 바꿀 수 있게, DB 경로를 읽는 모듈보다 먼저 불러온다.
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" ? value : fallback;
};
const host = "127.0.0.1";
// 다른 앱(senseful 4747)과 개발 서버(3000번대)와 겹치지 않게 4848을 쓴다.
const port = num("WONBOOK_PORT", 4848);
const idleMinutes = num("WONBOOK_IDLE_MINUTES", 30);
const idleMs = idleMinutes * 60_000;

async function main() {
  const { default: next } = await import("next");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { APP_DB_PATH, createDb } = await import("@/db/client");

  // 스키마가 바뀐 코드를 받아도 잊지 않게, 켤 때 마이그레이션을 적용한다(이미 적용한 것은 건너뛴다).
  fs.mkdirSync(path.dirname(APP_DB_PATH), { recursive: true });
  const db = createDb(APP_DB_PATH);
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  db.$client.close();

  const app = next({ dev: false, hostname: host, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  let lastActive = Date.now();
  let inFlight = 0;
  const server = createServer((req, res) => {
    inFlight++;
    lastActive = Date.now();
    res.on("close", () => {
      inFlight--;
      lastActive = Date.now();
    });
    handle(req, res);
  });
  server.listen(port, host, () => {
    const idle = idleMs > 0 ? `${idleMinutes}분 동안 요청이 없으면 종료` : "자동 종료 없음";
    console.log(`> ${new Date().toISOString()} http://localhost:${port} (${idle}, DB ${APP_DB_PATH})`);
  });

  if (idleMs > 0) {
    setInterval(() => {
      // 업로드·분류처럼 오래 걸리는 요청이 진행 중이면 기다린다.
      if (inFlight > 0 || Date.now() - lastActive < idleMs) return;
      console.log(`> ${new Date().toISOString()} ${idleMinutes}분 동안 요청이 없어 종료한다`);
      process.exit(0);
    }, Math.min(30_000, idleMs)).unref();
  }
}

main();
