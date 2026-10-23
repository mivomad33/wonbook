// 원격 DB·백업의 개인정보 검사(4.7-1, 4.7-2, 4.8-4). 개수와 통과 여부만 출력한다.
// 사용:
//   pnpm check:db [--test]          개발(기본)·테스트 DB를 바로 읽어 검사
//   pnpm check:db --backup <파일>    암호화 백업을 검사(운영은 이 방식). 복호화한 내용은 메모리와 파이프로만 다룬다.
// 검사:
// - 원격 스키마에 거래 원본 행·계좌번호 전체·DB 파일 백업 경로 열이 없다(4.7-2)
// - 모든 테이블의 값(업로드 파일 이름 포함)에 내 계좌 식별값이 없다. 하이픈·공백을 지운 값으로도 찾는다(4.7-1)
// - 백업: 암호화된 파일을 평문 검색하면 내 계정 이름·거래 내용이 없고, 풀면 pg_restore로 읽히고, 틀린 키로는 풀리지 않는다(4.8-4)
import "../env";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { backupKey, decryptFile } from "../lib/backup";
import { target } from "../lib/target";
import { countAccountIds, loadAccountIds, ROOT } from "./basis";
import Database from "better-sqlite3";

const PG_RESTORE = process.env.PG_RESTORE || "/opt/homebrew/opt/postgresql@18/bin/pg_restore";
const FORBIDDEN_COLUMNS = ["raw", "backup_path", "external_key"];
const TABLES = ["users", "accounts", "imports", "import_undo", "transactions", "categories", "category_rules", "settings", "upload_staging"];

type Check = { name: string; ok: boolean; detail?: string };

function restoreToSql(dump: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(PG_RESTORE, ["-f", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out).toString("utf8")) : reject(new Error(`pg_restore 실패(${code}): ${err.slice(0, 200)}`))));
    p.stdin.end(dump);
  });
}

/** 내 계정 이름과 거래 내용(평문 검색 기준). 로컬 앱 DB에서 읽고, 짧아서 흔한 글자는 뺀다. */
function myTexts(): string[] {
  const db = new Database(path.join(ROOT, "data/wonbook.db"), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("select name as s from accounts union select description from transactions").all() as { s: string }[];
    return [...new Set(rows.map((r) => r.s.trim()).filter((s) => Buffer.byteLength(s) >= 9))];
  } finally {
    db.close();
  }
}

async function checkBackup(file: string): Promise<Check[]> {
  const enc = fs.readFileSync(file);
  const plainHits = myTexts().filter((s) => enc.includes(Buffer.from(s)));
  const checks: Check[] = [{ name: "암호화된 백업 파일에 내 계정 이름·거래 내용이 평문으로 없다", ok: plainHits.length === 0, detail: `${plainHits.length}건` }];
  let wrongKeyFailed = false;
  try {
    await decryptFile(file, backupKey("wrong-key-for-check"));
  } catch {
    wrongKeyFailed = true;
  }
  checks.push({ name: "틀린 키로는 풀리지 않는다", ok: wrongKeyFailed });
  const dump = await decryptFile(file, backupKey());
  const sqlText = await restoreToSql(dump);
  checks.push({ name: "풀면 pg_restore로 읽힌다", ok: /CREATE TABLE public\.transactions/.test(sqlText) });
  checks.push(...contentChecks(sqlText, sqlText));
  return checks;
}

function contentChecks(schemaText: string, dataText: string): Check[] {
  const columns = FORBIDDEN_COLUMNS.filter((c) => new RegExp(`\\b${c}\\b\\s+(text|jsonb|integer)`).test(schemaText));
  const ids = countAccountIds(dataText, loadAccountIds());
  return [
    { name: "원본 행·계좌번호 전체·백업 경로 열이 없다", ok: columns.length === 0, detail: columns.join(", ") || "없음" },
    { name: "내 계좌 식별값이 없다(업로드 파일 이름 포함)", ok: ids === 0, detail: `${ids}건` },
  ];
}

async function checkDb(url: string): Promise<Check[]> {
  const c = new Client({ connectionString: url.replace("sslmode=require", "sslmode=verify-full") });
  await c.connect();
  try {
    const cols = await c.query<{ table_name: string; column_name: string; data_type: string }>(
      "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'",
    );
    const schemaText = cols.rows.map((r) => `${r.table_name}.${r.column_name} ${r.data_type}`).join("\n");
    const union = TABLES.map((t) => `select row_to_json(x)::text as j from ${t} x`).join(" union all ");
    const data = await c.query<{ s: string | null }>(`select string_agg(j, E'\\n') as s from (${union}) q`);
    return contentChecks(schemaText, data.rows[0].s ?? "");
  } finally {
    await c.end();
  }
}

async function main() {
  const i = process.argv.indexOf("--backup");
  let checks: Check[];
  if (i >= 0) {
    const file = process.argv[i + 1];
    if (!file) throw new Error("--backup 뒤에 백업 파일 경로를 줍니다");
    console.log(`대상: 백업 ${path.basename(file)}`);
    checks = await checkBackup(file);
  } else {
    if (process.argv.includes("--prod")) throw new Error("운영 DB는 백업으로 검사합니다(pnpm db:backup --prod 뒤 --backup <파일>)");
    checks = await checkDb(target().url);
  }
  for (const ch of checks) console.log(`${ch.ok ? "✓" : "✗"} ${ch.name}${ch.detail ? ` (${ch.detail})` : ""}`);
  if (checks.some((ch) => !ch.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
