// 배포 결과물 검사(4.10-10). vercel build가 만든 .vercel/output과, 함수가 참조해 함께 올라가는 파일(filePathMap)을 본다.
// 사용: tsx scripts/checks/output-check.ts [프로젝트 폴더(기본 저장소 루트)]  — 배포 명령이 업로드 전에 자동으로 부른다.
//       tsx scripts/checks/output-check.ts --self-test  — 일부러 금지 문자열 등을 넣은 가짜 결과물에서 검사가 실패하는지 본다.
// 찾은 문자열은 출력하지 않고 종류와 파일만 알린다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BasisMissingError, countAccountIds, loadBasis, patternFile, ROOT, type Basis } from "./basis";
import { checkJsonLd, checkPublicPage, checkRobots, checkSitemap, DEV_LOGIN_MARKER, iconHrefs, isNoindex, OG_IMAGE_PATH, PUBLIC_PATHS } from "./page-rules";

const BINARY = /\.(png|ico|jpe?g|gif|webp|avif|woff2?|ttf|otf|wasm|node|br|gz|zip)$/i;

/** 디렉터리 아래 모든 파일(심볼릭 링크를 따라간다) */
function walk(dir: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const go = (d: string) => {
    const real = fs.realpathSync(d);
    if (seen.has(real)) return;
    seen.add(real);
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) go(p);
      else out.push(p);
    }
  };
  if (fs.existsSync(dir)) go(dir);
  return out;
}

/** 함수가 참조하는 프로젝트 파일(업로드 대상). filePathMap의 값은 프로젝트 폴더 기준 경로다. */
function mappedFiles(project: string, output: string): string[] {
  const out = new Set<string>();
  for (const f of walk(path.join(output, "functions"))) {
    if (path.basename(f) !== ".vc-config.json") continue;
    const c = JSON.parse(fs.readFileSync(f, "utf8")) as { filePathMap?: Record<string, string> };
    for (const v of Object.values(c.filePathMap ?? {})) {
      const p = path.resolve(project, v);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) walk(p).forEach((x) => out.add(x));
      else out.add(p);
    }
  }
  return [...out];
}

/** 여러 파일에서 패턴 파일의 문자열이 들어 있는 파일 목록. git grep(--no-index)의 고정 문자열 검색을 쓴다. */
function grepFiles(files: string[], patterns: string, flags: string[]): string[] {
  const hits: string[] = [];
  const byRoot = new Map<string, string[]>();
  for (const f of files) {
    const root = f.includes("/node_modules/") ? f.slice(0, f.indexOf("/node_modules/")) : path.dirname(f);
    byRoot.set(root, [...(byRoot.get(root) ?? []), path.relative(root, f)]);
  }
  for (const [root, rel] of byRoot) {
    for (let i = 0; i < rel.length; i += 300) {
      try {
        const out = execFileSync("git", ["grep", "--no-index", "-l", "-F", ...flags, "-f", patterns, "--", ...rel.slice(i, i + 300)], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
        hits.push(...out.split("\n").filter(Boolean).map((r) => path.join(root, r)));
      } catch (e) {
        if ((e as { status?: number }).status !== 1) throw e;
      }
    }
  }
  return hits;
}

/** 결과물에 있으면 안 되는 파일인지. 이유를 돌려준다. */
export function forbiddenFile(rel: string): string | null {
  const base = path.basename(rel);
  const inDeps = rel.includes("node_modules/");
  const dir = /(^|\/)(data|samples|docs)\//.exec(rel)?.[2];
  if (dir && !inDeps) return `${dir}/ 파일`;
  if (/\.db(-\w+)?$/i.test(base)) return "DB 파일";
  if (/\.xlsx?$/i.test(base)) return "거래 내역 파일(xls·xlsx)";
  if (base.startsWith(".env")) return "환경 변수 파일";
  return null;
}

/** 정적 페이지 HTML. 경로마다 Vercel 결과물의 몇 가지 위치를 찾아본다. */
function pageHtml(output: string, route: string): string | null {
  const name = route === "/" ? "index" : route.slice(1);
  const candidates = [
    path.join(output, "functions", `${name}.prerender-fallback.html`),
    path.join(output, "static", `${name}.html`),
    path.join(output, "static", name, "index.html"),
  ];
  const f = candidates.find((c) => fs.existsSync(c));
  return f ? fs.readFileSync(f, "utf8") : null;
}

/** 정적 파일 본문(robots.txt, sitemap.xml, 아이콘 등). */
function staticBody(output: string, name: string): Buffer | null {
  const candidates = [path.join(output, "functions", `${name}.prerender-fallback.body`), path.join(output, "static", name)];
  const f = candidates.find((c) => fs.existsSync(c));
  return f ? fs.readFileSync(f) : null;
}

/** 금지 파일과 금지 내용(금지 문자열, 비밀 값, 내 계좌 식별값, 테스트 로그인 흔적) */
export function checkContents(project: string, basis: Basis): { failures: string[]; scanned: number } {
  const output = path.join(project, ".vercel/output");
  const failures: string[] = [];
  const rel = (f: string) => path.relative(project, f);
  const files = [...new Set([...walk(output), ...mappedFiles(project, output)])];

  for (const f of files) {
    if (!fs.existsSync(f)) failures.push(`참조한 파일이 없습니다: ${rel(f)}`);
    const why = forbiddenFile(rel(f));
    if (why) failures.push(`${why}: ${rel(f)}`);
    if (rel(f).includes(DEV_LOGIN_MARKER)) failures.push(`테스트 로그인 경로 파일: ${rel(f)}`);
  }

  const existing = files.filter((f) => fs.existsSync(f));
  const text = existing.filter((f) => !BINARY.test(f));
  const plain = patternFile(basis.patterns.filter((p) => !p.word).map((p) => p.text));
  const word = patternFile(basis.patterns.filter((p) => p.word).map((p) => p.text));
  const secrets = patternFile(basis.secrets);
  const marker = patternFile([DEV_LOGIN_MARKER]);
  try {
    if (basis.patterns.some((p) => !p.word)) for (const f of grepFiles(text, plain.file, ["-i"])) failures.push(`금지 문자열: ${rel(f)}`);
    if (basis.patterns.some((p) => p.word)) for (const f of grepFiles(text, word.file, ["-i", "-w"])) failures.push(`금지 문자열: ${rel(f)}`);
    if (basis.secrets.length) for (const f of grepFiles(existing, secrets.file, ["--text"])) failures.push(`비밀 값: ${rel(f)}`);
    for (const f of grepFiles(text, marker.file, [])) failures.push(`테스트 로그인 흔적: ${rel(f)}`);
  } finally {
    [plain, word, secrets, marker].forEach((p) => p.cleanup());
  }
  // 계좌 식별값은 하이픈·공백을 지운 내용에서도 찾아야 해서 직접 읽는다.
  const ids = basis.accountIds ?? [];
  if (ids.length) for (const f of text) if (countAccountIds(fs.readFileSync(f, "latin1"), ids)) failures.push(`내 계좌 식별값: ${rel(f)}`);

  return { failures, scanned: files.length };
}

/** 공개 페이지·아이콘·og:image·robots.txt·sitemap.xml·테스트 로그인 경로 */
export async function checkPages(project: string): Promise<string[]> {
  const output = path.join(project, ".vercel/output");
  const failures: string[] = [];
  for (const route of PUBLIC_PATHS) {
    const html = pageHtml(output, route);
    if (html === null) {
      failures.push(`정적 페이지가 없습니다: ${route}`);
      continue;
    }
    if (isNoindex(html)) failures.push(`${route}: noindex가 있습니다`);
    for (const b of checkPublicPage(html, route)) failures.push(`${route}: ${b}`);
    if (route === "/") for (const b of checkJsonLd(html)) failures.push(`/: ${b}`);
    for (const href of new Set(iconHrefs(html))) {
      const name = href.split("?")[0].slice(1);
      if (staticBody(output, name) === null) failures.push(`${route}: 아이콘 파일이 결과물에 없습니다(${name})`);
    }
  }
  if (staticBody(output, OG_IMAGE_PATH.slice(1)) === null) failures.push(`og:image 파일(${OG_IMAGE_PATH})이 결과물에 없습니다`);
  const robots = staticBody(output, "robots.txt");
  if (robots === null) failures.push("robots.txt가 결과물에 없습니다");
  else failures.push(...(await checkRobots(robots.toString("utf8"))));
  const sitemap = staticBody(output, "sitemap.xml");
  if (sitemap === null) failures.push("sitemap.xml이 결과물에 없습니다");
  else failures.push(...checkSitemap(sitemap.toString("utf8")));
  return failures;
}

export async function checkOutput(project: string, basis: Basis): Promise<{ failures: string[]; scanned: number }> {
  const output = path.join(project, ".vercel/output");
  if (!fs.existsSync(output)) return { failures: [`결과물이 없습니다: ${output}`], scanned: 0 };
  const { failures, scanned } = checkContents(project, basis);
  return { failures: [...failures, ...(await checkPages(project))], scanned };
}

/**
 * 가짜 결과물에 금지 문자열·비밀 값·계좌 식별값(하이픈을 넣은 모양)·금지 파일·테스트 로그인 흔적을 하나씩 넣고 모두 잡히는지 본다.
 * 실제 기준 값을 쓰지만 출력하지 않고, 가짜 결과물은 OS 임시 폴더에 만들고 지운다.
 */
async function selfTest(basis: Basis): Promise<boolean> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-output-selftest-"));
  try {
    const out = path.join(dir, ".vercel/output");
    const put = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.writeFileSync(path.join(out, rel), body, { mode: 0o600 });
    };
    const forbidden = basis.patterns[0];
    const id = basis.accountIds?.[0] ?? "";
    const cases: { kind: string; rel: string; body: string }[] = [
      { kind: "금지 문자열", rel: "static/a.js", body: `x = " ${forbidden.text} ";` },
      { kind: "비밀 값", rel: "static/b.js", body: `x = "${basis.secrets[0]}";` },
      { kind: "내 계좌 식별값", rel: "static/c.js", body: `x = "${id.slice(0, 3)}-${id.slice(3, 6)} ${id.slice(6)}";` },
      { kind: "테스트 로그인 흔적", rel: "static/d.js", body: `fetch("/api/auth/${DEV_LOGIN_MARKER}")` },
      { kind: "환경 변수 파일", rel: "static/.env.local", body: "A=1" },
      { kind: "data/ 파일", rel: "functions/x.func/data/x.txt", body: "x" },
      { kind: "DB 파일", rel: "functions/x.func/y.db", body: "x" },
    ];
    for (const c of cases) put(c.rel, c.body);
    put("static/clean.js", "console.log('ok')");
    const { failures } = await checkOutput(dir, basis);
    let ok = true;
    for (const c of cases) {
      const hit = failures.some((f) => f.startsWith(c.kind) && f.includes(path.basename(c.rel)));
      console.log(`${hit ? "✓" : "✗"} 넣은 ${c.kind}을 잡습니다`);
      ok &&= hit;
    }
    const clean = !failures.some((f) => f.includes("clean.js"));
    console.log(`${clean ? "✓" : "✗"} 깨끗한 파일은 통과합니다`);
    const pages = failures.some((f) => f.startsWith("정적 페이지가 없습니다"));
    console.log(`${pages ? "✓" : "✗"} 공개 페이지가 없으면 실패합니다`);
    return ok && clean && pages;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  let basis: Basis;
  try {
    basis = loadBasis({ accountIds: true });
  } catch (e) {
    if (e instanceof BasisMissingError) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  if (process.argv.includes("--self-test")) {
    const ok = await selfTest(basis);
    console.log(ok ? "✓ 배포 결과물 검사 자체 점검 통과" : "✗ 배포 결과물 검사 자체 점검 실패");
    process.exit(ok ? 0 : 1);
  }
  const project = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || ROOT);
  const { failures, scanned } = await checkOutput(project, basis);
  if (failures.length) {
    console.error(`✗ 배포 결과물 검사 실패: ${failures.length}건 (파일 ${scanned}개 검사)`);
    for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✓ 배포 결과물 검사 통과 (파일 ${scanned}개, 금지 파일·금지 문자열·비밀 값·계좌 식별값·공개 페이지·robots·sitemap·아이콘)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
