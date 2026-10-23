// 이전 연습(7장 사전 승인). test 브랜치에서 임시 브랜치를 만들어 실제 앱 DB를 옮겨 보고, 끝나면 그 브랜치를 지운다.
// 사용: pnpm db:import-rehearsal
// 확인: 옮긴 값 비교(4.8-3), 다시 실행해도 두 번 들어가지 않음, 옮긴 DB에 내 계좌 식별값이 없음(4.7-1, 업로드 파일 이름 포함).
import "./env";
import path from "node:path";
import { sql } from "drizzle-orm";
import { openDb } from "@/db/client";
import { adminEmail } from "@/config";
import { countAccountIds, loadAccountIds } from "./checks/basis";
import { compareImport } from "./lib/import-compare";
import { importLocal, openLocal } from "./lib/import-local";
import { connectionUri, deleteBranch, ensureBranch } from "./lib/neon";
import { resetSchema } from "./lib/reset-schema";

const REAL_DB = path.resolve(import.meta.dirname, "../data/wonbook.db");
const BRANCH = "import-rehearsal";

async function main() {
  const email = adminEmail();
  if (!email) throw new Error("ADMIN_EMAIL이 없습니다(.env.local)");
  const branch = await ensureBranch(BRANCH);
  console.log(`임시 브랜치 ${BRANCH}(test에서 분기)`);
  let failed = false;
  try {
    const url = await connectionUri(branch.id);
    await resetSchema(url);
    const local = openLocal(REAL_DB);
    const { db, pool } = openDb(url, 1);
    try {
      const now = new Date();
      const first = await importLocal(db, local, { email });
      console.log(`첫 실행: ${first.status}, 거래 ${first.counts.transactions}건`);
      const checks = await compareImport(db, first.userId, local, now);
      const count = async () => Number(((await db.execute(sql`select count(*)::int as n from transactions`)) as unknown as { rows: { n: number }[] }).rows[0].n);
      const before = await count();
      const second = await importLocal(db, local, { email });
      checks.push({ name: "다시 실행하면 옮기지 않고 거래 수가 같다", ok: second.status === "already" && (await count()) === before });
      // 모든 테이블의 텍스트를 모아 내 계좌 식별값을 찾는다(하이픈·공백을 지우고 찾는다).
      const tables = ["users", "accounts", "imports", "transactions", "categories", "category_rules", "settings"];
      const union = tables.map((t) => `select row_to_json(x)::text as j from ${t} x`).join(" union all ");
      const dump = ((await db.execute(sql.raw(`select string_agg(j, E'\\n') as s from (${union}) q`))) as unknown as { rows: { s: string }[] }).rows[0].s;
      checks.push({ name: "옮긴 DB에 내 계좌 식별값이 없다", ok: countAccountIds(dump, loadAccountIds()) === 0 });
      for (const ch of checks) console.log(`${ch.ok ? "✓" : "✗"} ${ch.name}`);
      failed = checks.some((ch) => !ch.ok);
    } finally {
      local.close();
      await pool.end();
    }
  } finally {
    await deleteBranch(branch.id);
    console.log(`임시 브랜치 ${BRANCH}를 지웠습니다`);
  }
  if (failed) throw new Error("이전 연습에서 맞지 않는 항목이 있습니다");
}

// 비교 기준으로 쓴 프로세스 안 Postgres(PGlite)가 남아 있어도 끝나게 한다.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(`실패: ${(e as Error).message}`);
    process.exit(1);
  },
);
