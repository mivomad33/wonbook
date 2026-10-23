// 내 데이터 이전(4.8-3). 사용: pnpm db:import-local [--from <SQLite 파일>] [--prod | --test]
// 기본 대상은 개발 DB다. 실제 앱 DB(data/wonbook.db)는 운영(--prod)으로만 옮긴다. 개발·테스트 DB에는 넣지 않는다(4.8-2).
// 운영은 옮기기 전에 자동으로 암호화 백업한다(4.8-4). 이미 관리자 데이터가 있으면 바꾸지 않고 멈춘다.
// 옮긴 뒤 이전 직전 로컬 DB로 계산한 값과 견준다(4.8-3). 출력에는 개수와 통과 여부만 쓴다.
import "./env";
import path from "node:path";
import { openDb } from "@/db/client";
import { adminEmail } from "@/config";
import { compareImport } from "./lib/import-compare";
import { importLocal, openLocal } from "./lib/import-local";
import { backupBeforeChange, target } from "./lib/target";

const REAL_DB = path.resolve(import.meta.dirname, "../data/wonbook.db");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const from = path.resolve(arg("--from") ?? REAL_DB);
  const t = target();
  if (from === REAL_DB && t.key !== "prod") throw new Error("실제 앱 DB는 운영(--prod)으로만 옮깁니다. 연습은 pnpm db:import-rehearsal로 합니다");
  const email = adminEmail();
  if (!email) throw new Error("ADMIN_EMAIL이 없습니다(.env.local)");
  const local = openLocal(from);
  const now = new Date();
  await backupBeforeChange(t);
  const { db, pool } = openDb(t.url, 1);
  try {
    const r = await importLocal(db, local, { email });
    const c = r.counts;
    if (r.status === "already") console.log("관리자 계정에 이미 데이터가 있어 옮기지 않았습니다(다시 옮기려면 관리자 데이터를 먼저 지워야 합니다).");
    else console.log(`옮김: 계정 ${c.accounts}, 카테고리 ${c.categories}, 업로드 기록 ${c.imports}, 거래 ${c.transactions}, 저장된 분류 ${c.rules}, 설정 ${c.settings}`);
    const checks = await compareImport(db, r.userId, local, now);
    for (const ch of checks) console.log(`${ch.ok ? "✓" : "✗"} ${ch.name}`);
    if (checks.some((ch) => !ch.ok)) throw new Error("이전 결과가 로컬 DB와 다릅니다");
  } finally {
    local.close();
    await pool.end();
  }
}

// 비교 기준으로 쓴 프로세스 안 Postgres(PGlite)가 남아 있어도 끝나게 한다.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(`실패: ${(e as Error).message}`);
    process.exit(1);
  },
);
