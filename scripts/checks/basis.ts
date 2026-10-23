// 공개 저장소·배포 결과물·운영 사이트 검사의 기준을 읽는다.
// 기준(금지 문자열, 비밀 값, 내 계좌 식별값)은 공개 저장소에 두지 않는다. 이 파일에는 기준 자체를 쓰지 않는다.
// - 금지 문자열: 저장소 밖 비공개 문서 폴더의 목록 파일(계좌번호, 실제 거래에서 나온 개인 정보 등)
// - 비밀 값: .env.local의 비밀 변수 값(공개 값인 GOOGLE_CLIENT_ID 제외)
// - 내 계좌 식별값: 로컬 앱 DB(data/wonbook.db)의 accounts.external_key 중 5자리 이상(배포 결과물·운영 사이트 검사만)
// 하나라도 없으면 검사를 건너뛰지 않고 예외를 던진다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const LIST_FILE = path.join(ROOT, "docs/checks/forbidden-strings.txt");
const ENV_FILE = path.join(ROOT, ".env.local");
const LOCAL_DB = path.join(ROOT, "data/wonbook.db");

/** 비밀 변수 이름 규칙에 들어도 공개해도 되는 값 */
const PUBLIC_ENV = ["GOOGLE_CLIENT_ID"];
/** 내 계좌 식별값으로 보는 최소 자릿수(4.0 용어). 끝 4자리 값은 금액·시각과 구별할 수 없어 뺀다. */
const MIN_ACCOUNT_ID_LEN = 5;

export interface Pattern {
  text: string;
  /** 단어 단위로만 찾는다 */
  word: boolean;
}

export interface Basis {
  patterns: Pattern[];
  secrets: string[];
  /** 내 계좌 식별값(하이픈·공백을 지운 값). 배포 결과물·운영 사이트 검사에서만 채운다. */
  accountIds?: string[];
}

export class BasisMissingError extends Error {}

/** 비밀 변수인지. 이름에 KEY·SECRET·TOKEN·PASSWORD·DATABASE_URL이 들어가거나 관리자 이메일이다. */
export function isSecretName(name: string): boolean {
  return /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name) || name === "ADMIN_EMAIL";
}

/** .env 형식에서 이름과 값. 값을 감싼 따옴표는 뺀다. */
export function parseEnv(text: string): { name: string; value: string }[] {
  return text
    .split("\n")
    .map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ name: m[1], value: m[2].replace(/^(['"])(.*)\1$/, "$2") }));
}

export function parsePatterns(text: string): Pattern[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => (l.startsWith("word:") ? { text: l.slice(5), word: true } : { text: l, word: false }));
}

function need(file: string): void {
  if (!fs.existsSync(file)) throw new BasisMissingError(`검사 기준이 없어 공개 저장소 검사를 할 수 없습니다: ${path.relative(ROOT, file)}`);
}

/** 하이픈·공백을 지운다. 계좌번호는 이 형태로 비교한다. */
export const stripSeparators = (s: string) => s.replace(/[-\s]/g, "");

/** 내 계좌 식별값. 로컬 앱 DB를 읽기 전용으로 연다. */
export function loadAccountIds(file = LOCAL_DB): string[] {
  need(file);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("select distinct external_key k from accounts where external_key is not null").all() as { k: string }[];
    const ids = [...new Set(rows.map((r) => stripSeparators(r.k)).filter((k) => k.length >= MIN_ACCOUNT_ID_LEN))];
    if (ids.length === 0) throw new BasisMissingError("내 계좌 식별값을 읽지 못해 검사를 할 수 없습니다.");
    return ids;
  } finally {
    db.close();
  }
}

/** opts.accountIds면 내 계좌 식별값도 읽는다(배포 결과물·운영 사이트 검사). */
export function loadBasis(opts: { accountIds?: boolean } = {}): Basis {
  for (const f of [LIST_FILE, ENV_FILE]) need(f);
  const patterns = parsePatterns(fs.readFileSync(LIST_FILE, "utf8"));
  if (patterns.length === 0) throw new BasisMissingError("금지 문자열 목록이 비어 있어 검사를 할 수 없습니다.");
  const secrets = parseEnv(fs.readFileSync(ENV_FILE, "utf8"))
    .filter((e) => isSecretName(e.name) && !PUBLIC_ENV.includes(e.name) && e.value.length >= 6)
    .map((e) => e.value);
  if (secrets.length === 0) throw new BasisMissingError("비밀 값을 읽지 못해 검사를 할 수 없습니다.");
  return { patterns, secrets, ...(opts.accountIds ? { accountIds: loadAccountIds() } : {}) };
}

/** 패턴 목록을 grep -f용 임시 파일로 쓴다. 다 쓰면 cleanup을 부른다. 저장소 밖(OS 임시 폴더)에 둔다. */
export function patternFile(lines: string[]): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-check-"));
  const file = path.join(dir, "p.txt");
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 문자열에 든 내 계좌 식별값 수. 하이픈·공백을 지운 내용에서 찾는다. */
export function countAccountIds(text: string, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const s = stripSeparators(text);
  return ids.filter((id) => s.includes(id)).length;
}

/**
 * 문자열 하나에서 찾은 기준의 종류별 개수. 찾은 문자열 자체는 돌려주지 않는다.
 * 금지 문자열은 대소문자를 무시하고, 비밀 값은 그대로, 계좌 식별값은 하이픈·공백을 지우고 찾는다.
 */
export function scanText(text: string, basis: Basis): { forbidden: number; secret: number; account: number } {
  const lower = text.toLowerCase();
  let forbidden = 0;
  for (const p of basis.patterns) {
    if (p.word ? new RegExp(`(?<![A-Za-z0-9_])${escapeRe(p.text)}(?![A-Za-z0-9_])`, "i").test(text) : lower.includes(p.text.toLowerCase())) forbidden++;
  }
  const secret = basis.secrets.filter((s) => text.includes(s)).length;
  return { forbidden, secret, account: countAccountIds(text, basis.accountIds ?? []) };
}
