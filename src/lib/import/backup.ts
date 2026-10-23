// 덮어쓰기 직전 DB 백업(3단계 파일 6장, 결정 D6).
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/db/client";

// 폴더마다 남길 백업 수. 한 달에 한두 번 올리면 1년 넘게 남는다.
export const BACKUP_KEEP = 20;

// data/backups/<DB 파일 이름>/. DB 경로마다 나눠, 시드 DB 백업이 앱 백업의 개수 제한에 끼지 않게 한다.
export function backupDirFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backups", path.basename(dbPath, path.extname(dbPath)));
}

// YYYYMMDD-HHMMSS(실행하는 컴퓨터 시간대, 한국 시간)
function timestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const BACKUP_NAME = /^(\d{8}-\d{6})(?:-(\d+))?\.db$/;

// 이 폴더의 백업 파일을 오래된 순으로. 확장자를 뺀 이름순이고, 같은 초의 `-2`, `-3`은 번호순이다.
// 이름 형식이 다른 파일은 건드리지 않는다.
export function listBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, m: BACKUP_NAME.exec(name) }))
    .filter((f): f is { name: string; m: RegExpExecArray } => f.m != null)
    .sort((a, b) => a.m[1].localeCompare(b.m[1]) || Number(a.m[2] ?? 1) - Number(b.m[2] ?? 1))
    .map((f) => path.join(dir, f.name));
}

// VACUUM INTO로 열린 연결 그대로 일관된 복사본을 만들고, keep개를 넘는 오래된 백업을 지운다. 만든 파일 경로를 돌려준다.
// 트랜잭션 안에서는 쓸 수 없으므로 반영 트랜잭션 전에 부른다.
export function createBackup(db: Db, dir: string, options: { now?: Date; keep?: number } = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const base = timestamp(options.now ?? new Date());
  let file = path.join(dir, `${base}.db`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.db`);
  db.$client.prepare("VACUUM INTO ?").run(file);

  const backups = listBackups(dir);
  const extra = backups.length - (options.keep ?? BACKUP_KEEP);
  for (const old of backups.slice(0, Math.max(0, extra))) fs.rmSync(old);
  return file;
}
