// 운영 배포(4.10-11, 4.10-13). 사용: pnpm release [--remote-build]
// 순서: verify → 커밋된 파일만 작업 폴더 밖 임시 폴더로 꺼내기 → vercel build(Production) → 배포 결과물 검사
//       → vercel deploy --prebuilt --prod → 배포 뒤 점검(실패하면 20초 간격으로 3번까지).
// --remote-build: 위와 같이 로컬 빌드와 결과물 검사를 통과한 뒤, 같은 커밋을 꺼낸 깨끗한 임시 폴더를 vercel deploy --prod(원격 빌드)로 올린다.
//   prebuilt 배포에서 사용 분석 수집 경로가 동작하지 않을 때만 쓴다(README "배포").
// 작업 폴더에서 vercel build·deploy를 하지 않는다. 함수가 참조하는 파일에 .env.local 같은 로컬 파일이 섞이지 않게 하고,
// 운영 배포의 코드가 커밋과 같게 하기 위해서다. 그래서 커밋하지 않은 변경이 있으면 배포하지 않는다.
// vercel pull은 임시 폴더에서만 한다(작업 폴더의 .env.local을 덮어쓰지 않는다).
import "./env";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE_URL } from "@/config";
import { ROOT } from "./checks/basis";

/** Vercel CLI 버전(README에도 적는다) */
export const VERCEL = "vercel@65.1.0";
const PROJECT_JSON = path.join(ROOT, ".vercel/project.json");
/** 배포 뒤 점검의 종료 코드: 사용 분석 스크립트만 실패 */
const SMOKE_ANALYTICS_ONLY = 3;

class StepError extends Error {}

function run(label: string, cmd: string, args: string[], cwd: string, capture = false): string {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (r.status !== 0) throw new StepError(`${label} 실패. 배포를 멈춥니다.`);
  return r.stdout ?? "";
}

/** 커밋(HEAD)의 파일만 dir로 꺼낸다. 비공개·비밀 파일은 git에 없지만 혹시 있어도 지운다. */
function exportCommit(dir: string): void {
  execFileSync("sh", ["-c", `git archive --format=tar HEAD | tar -x -C "${dir}"`], { cwd: ROOT });
  for (const name of fs.readdirSync(dir)) if (name.startsWith(".env")) fs.rmSync(path.join(dir, name), { force: true });
  for (const d of ["data", "samples", "docs"]) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, ".vercel"));
  fs.copyFileSync(PROJECT_JSON, path.join(dir, ".vercel/project.json"));
}

function smoke(): void {
  for (let attempt = 1; ; attempt++) {
    console.log(`\n▶ 배포 뒤 점검 (${attempt}번째)`);
    const status = spawnSync("pnpm", ["exec", "tsx", "scripts/smoke.ts", SITE_URL], { cwd: ROOT, stdio: "inherit" }).status;
    if (status === 0) return;
    if (attempt === 3) {
      if (status === SMOKE_ANALYTICS_ONLY) {
        throw new StepError(
          "배포 뒤 점검에서 사용 분석 스크립트만 실패했습니다. Web Analytics가 켜져 있는지 확인하고 한 번 다시 배포합니다. 그래도 안 되면 pnpm release --remote-build로 배포합니다(4.10-13).",
        );
      }
      throw new StepError("배포 뒤 점검 실패.");
    }
    // 운영 주소가 새 배포로 바뀐 직후에는 정적 파일이 잠깐 404일 수 있다.
    console.log("20초 뒤 다시 점검합니다.");
    execFileSync("sleep", ["20"]);
  }
}

function main(): void {
  const remote = process.argv.includes("--remote-build");
  if (!fs.existsSync(PROJECT_JSON)) throw new StepError(`.vercel/project.json이 없습니다. 먼저 저장소 루트에서 npx --yes ${VERCEL} link --project wonbook을 실행합니다.`);
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty) throw new StepError("커밋하지 않은 변경이 있어 배포하지 않습니다. 커밋한 뒤 다시 실행합니다.");
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  run("verify", "pnpm", ["run", "verify"], ROOT);

  const dirs: string[] = [];
  const tmp = (name: string) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `wonbook-${name}-${sha}-`));
    dirs.push(d);
    return d;
  };
  try {
    const project = tmp("deploy");
    console.log(`\n▶ 커밋 ${sha}의 파일을 꺼냅니다: ${project}`);
    exportCommit(project);
    run("의존성 설치", "pnpm", ["install", "--frozen-lockfile"], project);
    run("Vercel 설정 받기(임시 폴더)", "npx", ["--yes", VERCEL, "pull", "--yes", "--environment=production"], project);
    run("vercel build (Production)", "npx", ["--yes", VERCEL, "build", "--prod"], project);
    run("배포 결과물 검사", "pnpm", ["exec", "tsx", "scripts/checks/output-check.ts", project], ROOT);

    let out: string;
    if (remote) {
      // 원격 빌드는 빌드 산출물·의존성·내려받은 환경 변수 파일이 없는 깨끗한 폴더를 올린다.
      const clean = tmp("remote");
      console.log(`\n▶ 원격 빌드용으로 커밋 ${sha}의 파일을 다시 꺼냅니다: ${clean}`);
      exportCommit(clean);
      out = run("vercel deploy --prod (원격 빌드)", "npx", ["--yes", VERCEL, "deploy", "--prod", "--yes"], clean, true);
    } else {
      out = run("vercel deploy --prebuilt --prod", "npx", ["--yes", VERCEL, "deploy", "--prebuilt", "--prod"], project, true);
    }
    console.log(out.trim());
    smoke();
    console.log(`\n✓ 배포 끝: ${SITE_URL} (커밋 ${sha}${remote ? ", 원격 빌드" : ""})`);
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}
