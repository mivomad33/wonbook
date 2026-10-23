// 공개 저장소 검사. 금지 문자열·비밀 값·비공개 파일이 커밋에 없는지 본다.
// 사용:
//   pnpm check:repo               모든 커밋, 모든 브랜치 이름, 모든 커밋 메시지
//   pre-push 훅                    push하는 커밋 범위(표준 입력의 ref 줄)와 브랜치 이름
// 찾은 문자열은 출력하지 않고 종류, 개수, 위치(커밋:파일:줄)만 알린다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { BasisMissingError, loadBasis, patternFile, ROOT, scanText, type Basis } from "./basis";

const ZERO = /^0+$/;

function git(args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"] });
}

/** git grep 결과 줄(커밋:파일:줄:내용)에서 위치만. 매치가 없으면 git grep은 1로 끝난다. */
function gitGrep(args: string[]): string[] {
  try {
    return git(["grep", "-I", "-n", ...args])
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

/** lockfile의 integrity 해시 값은 우연히 짧은 문자열과 겹칠 수 있어 뺀다. */
const isLockHash = (line: string) => /pnpm-lock\.yaml:\d+:.*integrity: /.test(line);
const where = (line: string) => line.split(":").slice(0, 3).join(":");

/** 저장소에 있으면 안 되는 파일: 비공개 문서, 금융사 샘플, 로컬 DB와 백업, 비밀 값, 거래 내역 파일 */
function isPrivateFile(p: string): boolean {
  const base = p.split("/").at(-1)!;
  const privateDir = /^(docs|samples|data)\//.test(p);
  const env = base.startsWith(".env") && base !== ".env.example";
  return privateDir || env || /\.(db|xls|xlsx)$/i.test(base);
}

interface Finding {
  kind: string;
  at: string;
}

function scanCommit(commit: string, files: { plain: string; word: string; secret: string }): Finding[] {
  const out: Finding[] = [];
  const add = (kind: string, lines: string[]) => lines.filter((l) => !isLockHash(l)).forEach((l) => out.push({ kind, at: where(l) }));
  add("금지 문자열", gitGrep(["-i", "-F", "-f", files.plain, commit, "--"]));
  if (fs.statSync(files.word).size > 1) add("금지 문자열", gitGrep(["-i", "-w", "-F", "-f", files.word, commit, "--"]));
  add("비밀 값", gitGrep(["-F", "-f", files.secret, commit, "--"]));
  for (const p of git(["ls-tree", "-r", "--name-only", commit]).split("\n").filter(Boolean)) {
    if (isPrivateFile(p)) out.push({ kind: "비공개 파일", at: `${commit.slice(0, 8)}:${p}` });
  }
  return out;
}

function scanMeta(label: string, text: string, basis: Basis): Finding[] {
  const s = scanText(text, basis);
  return [
    ...(s.forbidden ? [{ kind: `금지 문자열 ${s.forbidden}종`, at: label }] : []),
    ...(s.secret ? [{ kind: `비밀 값 ${s.secret}건`, at: label }] : []),
  ];
}

export function checkRepo(commits: string[], branches: string[], basis: Basis): Finding[] {
  const plain = patternFile(basis.patterns.filter((p) => !p.word).map((p) => p.text));
  const word = patternFile(basis.patterns.filter((p) => p.word).map((p) => p.text));
  const secret = patternFile(basis.secrets);
  try {
    const found: Finding[] = [];
    // 커밋마다 트리 전체를 본다. 같은 트리는 한 번만 본다.
    const seen = new Set<string>();
    for (const c of commits) {
      const tree = git(["rev-parse", `${c}^{tree}`]).trim();
      if (seen.has(tree)) continue;
      seen.add(tree);
      found.push(...scanCommit(c, { plain: plain.file, word: word.file, secret: secret.file }));
    }
    for (const c of commits) found.push(...scanMeta(`커밋 메시지 ${c.slice(0, 8)}`, git(["log", "-1", "--format=%B", c]), basis));
    for (const b of branches) found.push(...scanMeta(`브랜치 이름 ${b.length}자`, b, basis));
    return found;
  } finally {
    [plain, word, secret].forEach((f) => f.cleanup());
  }
}

/** pre-push 표준 입력(<local ref> <local sha> <remote ref> <remote sha>)에서 push하는 커밋과 브랜치 이름 */
function pushRange(stdin: string, remote: string): { commits: string[]; branches: string[] } {
  const commits = new Set<string>();
  const branches = new Set<string>();
  for (const line of stdin.split("\n").filter(Boolean)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(" ");
    if (ZERO.test(localSha)) continue; // 원격 브랜치 삭제
    branches.add(localRef.replace(/^refs\/heads\//, ""));
    branches.add(remoteRef.replace(/^refs\/heads\//, ""));
    const range = ZERO.test(remoteSha) ? [localSha, "--not", `--remotes=${remote}`] : [`${remoteSha}..${localSha}`];
    git(["rev-list", ...range])
      .split("\n")
      .filter(Boolean)
      .forEach((c) => commits.add(c));
  }
  return { commits: [...commits], branches: [...branches] };
}

function main() {
  const prePush = process.argv.includes("--pre-push");
  let basis: Basis;
  try {
    basis = loadBasis();
  } catch (e) {
    if (e instanceof BasisMissingError) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  const { commits, branches } = prePush
    ? pushRange(fs.readFileSync(0, "utf8"), process.argv[process.argv.indexOf("--pre-push") + 1] || "origin")
    : {
        commits: git(["rev-list", "--all"]).split("\n").filter(Boolean),
        branches: git(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]).split("\n").filter(Boolean),
      };
  const found = checkRepo(commits, branches, basis);
  if (found.length) {
    console.error(`✗ 공개 저장소 검사 실패: ${found.length}건 (커밋 ${commits.length}개, 브랜치 ${branches.length}개 검사)`);
    for (const f of found.slice(0, 50)) console.error(`  - ${f.kind}: ${f.at}`);
    process.exit(1);
  }
  console.log(`✓ 공개 저장소 검사 통과 (커밋 ${commits.length}개, 브랜치 ${branches.length}개, 금지 문자열 ${basis.patterns.length}개 기준)`);
}

main();
