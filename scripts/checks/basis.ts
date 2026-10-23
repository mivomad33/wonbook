// 공개 저장소 검사의 기준을 읽는다.
// 기준(금지 문자열, 비밀 값)은 공개 저장소에 두지 않는다. 이 파일에는 기준 자체를 쓰지 않는다.
// - 금지 문자열: 저장소 밖 비공개 문서 폴더의 목록 파일(계좌번호, 실제 거래에서 나온 개인 정보 등)
// - 비밀 값: .env.local의 비밀 변수 값
// 둘 중 하나라도 없으면 검사를 건너뛰지 않고 예외를 던진다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const LIST_FILE = path.join(ROOT, "docs/checks/forbidden-strings.txt");
const ENV_FILE = path.join(ROOT, ".env.local");

export interface Pattern {
  text: string;
  /** 단어 단위로만 찾는다 */
  word: boolean;
}

export interface Basis {
  patterns: Pattern[];
  secrets: string[];
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

export function loadBasis(): Basis {
  for (const f of [LIST_FILE, ENV_FILE]) need(f);
  const patterns = parsePatterns(fs.readFileSync(LIST_FILE, "utf8"));
  if (patterns.length === 0) throw new BasisMissingError("금지 문자열 목록이 비어 있어 검사를 할 수 없습니다.");
  const secrets = parseEnv(fs.readFileSync(ENV_FILE, "utf8"))
    .filter((e) => isSecretName(e.name) && e.value.length >= 6)
    .map((e) => e.value);
  if (secrets.length === 0) throw new BasisMissingError("비밀 값을 읽지 못해 검사를 할 수 없습니다.");
  return { patterns, secrets };
}

/** 패턴 목록을 grep -f용 임시 파일로 쓴다. 다 쓰면 cleanup을 부른다. 저장소 밖(OS 임시 폴더)에 둔다. */
export function patternFile(lines: string[]): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-check-"));
  const file = path.join(dir, "p.txt");
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 문자열 하나에서 찾은 기준의 종류별 개수. 찾은 문자열 자체는 돌려주지 않는다.
 * 금지 문자열은 대소문자를 무시하고, 비밀 값은 그대로 찾는다.
 */
export function scanText(text: string, basis: Basis): { forbidden: number; secret: number } {
  const lower = text.toLowerCase();
  let forbidden = 0;
  for (const p of basis.patterns) {
    if (p.word ? new RegExp(`(?<![A-Za-z0-9_])${escapeRe(p.text)}(?![A-Za-z0-9_])`, "i").test(text) : lower.includes(p.text.toLowerCase())) forbidden++;
  }
  const secret = basis.secrets.filter((s) => text.includes(s)).length;
  return { forbidden, secret };
}
