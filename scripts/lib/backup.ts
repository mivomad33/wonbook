// 원격 DB를 내 맥에 암호화한 파일로 받는다(2.2, 4.8-4). pg_dump(custom 형식)의 출력을 바로 AES-256-GCM으로 암호화해 쓴다.
// 평문 덤프는 디스크에 닿지 않는다. 파일은 data/backups/(git·배포 제외)에 두고 대상마다 최근 10개만 남긴다.
// 파일 형식: "WBK1"(4바이트) + IV(12바이트) + 암호문 + 인증 태그(16바이트). 키는 BACKUP_ENCRYPTION_KEY 값의 SHA-256이다.
// 로컬 pg_dump가 서버보다 낮은 버전이면 덤프를 거부하므로 Homebrew postgresql@18의 pg_dump를 쓴다(PG_DUMP로 바꿀 수 있다).
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Target, TargetKey } from "./target";

const PG_DUMP = process.env.PG_DUMP || "/opt/homebrew/opt/postgresql@18/bin/pg_dump";
export const BACKUP_DIR = path.resolve(import.meta.dirname, "../../data/backups");
/** 대상마다 남기는 백업 수 */
export const KEEP = 10;

export const MAGIC = Buffer.from("WBK1");
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN;
const FILE_RE = /^(prod|dev|test)-\d{8}-\d{6}\.dump\.enc$/;

export class BackupDecryptError extends Error {}

/** 백업 암호화 키(32바이트). 환경 변수 값을 SHA-256으로 줄인다. */
export function backupKey(value = process.env.BACKUP_ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error("BACKUP_ENCRYPTION_KEY가 없습니다(.env.local)");
  return crypto.createHash("sha256").update(value).digest();
}

/** 평문 → "WBK1" + IV + 암호문 + 태그 */
export function encryptStream(key: Buffer): Transform {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  const start = (t: Transform) => {
    if (!started) t.push(Buffer.concat([MAGIC, iv]));
    started = true;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      start(this);
      this.push(cipher.update(chunk));
      cb();
    },
    flush(cb) {
      start(this);
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      cb();
    },
  });
}

/**
 * 암호문 → 평문. 끝의 16바이트(태그)는 마지막까지 들고 있다가 검증한다.
 * 태그 검증은 끝에서 하므로, 검증 전에 평문을 밖으로 내보내면 안 되는 곳은 decryptFile을 쓴다.
 */
export function decryptStream(key: Buffer): Transform {
  let header = Buffer.alloc(0);
  let decipher: crypto.DecipherGCM | null = null;
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      let data = chunk;
      if (!decipher) {
        header = Buffer.concat([header, data]);
        if (header.length < HEADER_LEN) return cb();
        if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return cb(new BackupDecryptError("백업 파일 형식이 아닙니다(WBK1 머리글 없음)"));
        decipher = crypto.createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length, HEADER_LEN));
        data = header.subarray(HEADER_LEN);
      }
      const buf = Buffer.concat([tail, data]);
      const cut = Math.max(0, buf.length - TAG_LEN);
      if (cut > 0) this.push(decipher.update(buf.subarray(0, cut)));
      tail = buf.subarray(cut);
      cb();
    },
    flush(cb) {
      if (!decipher || tail.length < TAG_LEN) return cb(new BackupDecryptError("백업 파일이 잘렸습니다"));
      decipher.setAuthTag(tail);
      try {
        this.push(decipher.final());
        cb();
      } catch {
        cb(new BackupDecryptError("복호화 실패: 키가 틀렸거나 파일이 손상되었습니다"));
      }
    },
  });
}

/** 파일 전체를 복호화해 메모리로 돌려준다. 태그 검증을 마친 뒤에만 돌려준다(틀린 키로 깨진 평문을 내보내지 않는다). */
export async function decryptFile(file: string, key: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(
    fs.createReadStream(file),
    decryptStream(key),
    async function* (src: AsyncIterable<Buffer>) {
      for await (const c of src) chunks.push(c);
    },
  );
  return Buffer.concat(chunks);
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 주소(비밀번호 포함)는 인자 대신 libpq 환경 변수로 나눠 넘겨 프로세스 목록에 보이지 않게 한다. */
function libpqEnv(url: string): Record<string, string> {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1),
    PGSSLMODE: u.searchParams.get("sslmode") || "require",
    PGCHANNELBINDING: u.searchParams.get("channel_binding") || "prefer",
  };
}

/** 대상의 백업 파일 중 오래된 것을 지우고 최근 keep개만 남긴다. 지운 파일 목록을 돌려준다. */
export function pruneBackups(dir: string, key: TargetKey, keep = KEEP): string[] {
  if (!fs.existsSync(dir)) return [];
  const mine = fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f) && f.startsWith(`${key}-`))
    .sort()
    .reverse();
  const old = mine.slice(keep).map((f) => path.join(dir, f));
  old.forEach((f) => fs.rmSync(f, { force: true }));
  return old;
}

/** 백업 파일 경로를 돌려준다. 실패하면 예외를 던진다(실패한 파일은 지운다). */
export async function backupDb(t: Target, dir = BACKUP_DIR): Promise<string> {
  if (!fs.existsSync(PG_DUMP)) throw new Error(`pg_dump가 없습니다: ${PG_DUMP} (brew install postgresql@18)`);
  const key = backupKey();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${t.key}-${stamp(new Date())}.dump.enc`);
  const partial = `${file}.partial`;
  const child = spawn(PG_DUMP, ["--format=custom", "--no-owner", "--no-privileges"], {
    env: { ...process.env, ...libpqEnv(t.url) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  try {
    await pipeline(child.stdout, encryptStream(key), fs.createWriteStream(partial, { mode: 0o600 }));
    const code = await exited;
    if (code !== 0) throw new Error(`백업 실패(pg_dump ${code}): ${stderr.split("\n")[0]}`);
    if (fs.statSync(partial).size <= HEADER_LEN + TAG_LEN) throw new Error("백업 파일이 비었습니다");
    fs.renameSync(partial, file);
  } catch (e) {
    child.kill();
    fs.rmSync(partial, { force: true });
    throw e;
  }
  const removed = pruneBackups(dir, t.key);
  if (removed.length) console.log(`오래된 백업 ${removed.length}개를 지웠습니다(최근 ${KEEP}개 유지)`);
  return file;
}
