// 배포 뒤 점검(4.10-11, 4.10-13). 배포된 사이트를 밖에서 요청해 확인한다. 상태를 바꾸는 요청(로그인, 쓰기)은 하지 않는다(GET만).
// 사용: pnpm smoke [주소]  (기본 https://wonbook.vercel.app)
// 항목별 통과·실패를 출력하고, 하나라도 실패하면 종료 코드 1로 끝난다.
// 사용 분석 스크립트(/_vercel/insights/script.js) 항목만 실패하면 종료 코드 3으로 끝난다. 배포 명령이 분석만의 문제를 따로 알아보게 하기 위해서다.
import "./env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SITE_URL } from "@/config";
import { BasisMissingError, loadBasis, ROOT, scanText, type Basis } from "./checks/basis";
import { checkJsonLd, checkPublicPage, checkRobots, checkSitemap, DEV_LOGIN_MARKER, ICON_PATHS, iconHrefs, OG_IMAGE_PATH, PUBLIC_PATHS } from "./checks/page-rules";

/** 로그인이 필요한 앱 화면 */
const APP_PATHS = ["/home", "/monthly", "/transactions", "/upload", "/accounts", "/categories", "/settings", "/admin"];
/** 로그인 없이 막혀야 하는 API(인증 경로 /api/auth/* 제외). 없는 경로도 401이어야 한다. */
const API_PATHS = ["/api/anything", "/api/export", "/api/admin"];
export const ANALYTICS_ITEM = "사용 분석 스크립트(/_vercel/insights/script.js) 200";

const base = (process.argv.slice(2).find((a) => !a.startsWith("--")) || SITE_URL).replace(/\/$/, "");
const results: { name: string; ok: boolean; note?: string }[] = [];
const record = (name: string, ok: boolean, note?: string) => {
  results.push({ name, ok, note });
  console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
};

async function get(p: string): Promise<Response> {
  return fetch(p.startsWith("http") ? p : `${base}${p}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
}

const REDIRECT = [301, 302, 303, 307, 308];
const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");

async function step(name: string, fn: () => Promise<string[] | void>) {
  try {
    const bad = (await fn()) ?? [];
    record(name, bad.length === 0, bad.join("; ") || undefined);
  } catch (e) {
    record(name, false, (e as Error).message);
  }
}

async function main() {
  console.log(`배포 뒤 점검: ${base}`);
  let basis: Basis | null = null;
  try {
    basis = loadBasis({ accountIds: true });
  } catch (e) {
    if (!(e instanceof BasisMissingError)) throw e;
    record("검사 기준 읽기", false, e.message);
  }
  const pages = new Map<string, string>();
  const assets = new Set<string>();

  for (const p of PUBLIC_PATHS) {
    await step(`${p} 200과 페이지 정보(제목·설명·canonical·미리보기·아이콘)`, async () => {
      const r = await get(p);
      if (r.status !== 200) return [`상태 ${r.status}`];
      const html = await r.text();
      pages.set(p, html);
      for (const m of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/_next\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)) assets.add(m[1]);
      return [
        ...checkPublicPage(html, p),
        ...(p === "/" ? checkJsonLd(html) : []),
        ...(r.headers.get("x-robots-tag")?.includes("noindex") ? ["X-Robots-Tag noindex"] : []),
      ];
    });
  }
  await step("/robots.txt", async () => {
    const r = await get("/robots.txt");
    return r.status === 200 ? checkRobots(await r.text()) : [`상태 ${r.status}`];
  });
  await step("/sitemap.xml", async () => {
    const r = await get("/sitemap.xml");
    return r.status === 200 ? checkSitemap(await r.text()) : [`상태 ${r.status}`];
  });
  await step("og:image 200, public/og.png와 같은 파일", async () => {
    const r = await get(OG_IMAGE_PATH);
    if (r.status !== 200) return [`상태 ${r.status}`];
    const got = md5(Buffer.from(await r.arrayBuffer()));
    return got === md5(fs.readFileSync(path.join(ROOT, "public", OG_IMAGE_PATH))) ? [] : ["public/og.png와 다릅니다"];
  });
  await step("파비콘 파일 200", async () => {
    const hrefs = new Set([...ICON_PATHS, ...iconHrefs(pages.get("/") ?? "")]);
    const bad: string[] = [];
    for (const h of hrefs) {
      const r = await get(h);
      if (r.status !== 200) bad.push(`${h.split("?")[0]} ${r.status}`);
    }
    return bad;
  });
  await step("데모가 열린다(200 또는 자산 현황으로 넘어감)", async () => {
    const r = await get("/demo");
    const loc = r.headers.get("location") ?? "";
    if (r.status === 200) return [];
    return REDIRECT.includes(r.status) && /\/home(\?|$)/.test(loc.replace(base, "")) ? [] : [`상태 ${r.status}`];
  });
  await step("로그인이 필요한 화면은 로그인 없이 소개 화면으로 가거나 막힌다", async () => {
    const bad: string[] = [];
    for (const p of APP_PATHS) {
      const r = await get(p);
      const loc = (r.headers.get("location") ?? "").replace(base, "");
      const toLanding = REDIRECT.includes(r.status) && (loc === "/" || loc.startsWith("/?"));
      const blocked = [401, 403].includes(r.status);
      if (!toLanding && !blocked) bad.push(`${p} 상태 ${r.status}`);
    }
    return bad;
  });
  await step("API는 로그인 없이 401(인증 경로 제외)", async () => {
    const bad: string[] = [];
    for (const p of API_PATHS) {
      const r = await get(p);
      if (r.status !== 401) bad.push(`${p} 상태 ${r.status}`);
    }
    return bad;
  });
  await step("테스트 로그인 경로가 동작하지 않는다(404)", async () => {
    const bad: string[] = [];
    for (const as of ["admin", "user1"]) {
      const r = await get(`/api/auth/${DEV_LOGIN_MARKER}?as=${as}`);
      if (r.headers.get("set-cookie")) bad.push(`${as}: 쿠키를 줍니다`);
      if ((r.headers.get("location") ?? "").includes("/home")) bad.push(`${as}: 자산 현황으로 보냅니다`);
      if (r.status !== 404) bad.push(`${as}: 상태 ${r.status}(404여야 합니다)`);
    }
    return bad;
  });
  await step("HTML·JS·CSS에 금지 문자열·비밀 값·내 계좌 식별값이 없다", async () => {
    if (!basis) return ["검사 기준이 없습니다"];
    const bad: string[] = [];
    const scan = (name: string, text: string) => {
      const s = scanText(text, basis!);
      if (s.forbidden || s.secret || s.account) bad.push(`${name.split("?")[0]}: 금지 ${s.forbidden}, 비밀 ${s.secret}, 계좌 ${s.account}`);
      if (text.includes(DEV_LOGIN_MARKER)) bad.push(`${name.split("?")[0]}: 테스트 로그인 흔적`);
    };
    for (const [p, html] of pages) scan(p, html);
    for (const a of assets) {
      const r = await get(a);
      if (r.status !== 200) bad.push(`${a.split("?")[0]} 상태 ${r.status}`);
      else scan(a, await r.text());
    }
    if (assets.size === 0) bad.push("불러오는 JS·CSS를 찾지 못했습니다");
    return bad;
  });
  await step("HTTPS로만 열리고 http는 https로 넘어간다", async () => {
    if (!base.startsWith("https://")) return ["주소가 https가 아닙니다"];
    const r = await get(base.replace("https://", "http://") + "/");
    const loc = r.headers.get("location") ?? "";
    return REDIRECT.includes(r.status) && loc.startsWith("https://") ? [] : [`http 상태 ${r.status}`];
  });
  await step(ANALYTICS_ITEM, async () => {
    const r = await get("/_vercel/insights/script.js");
    return r.status === 200 ? [] : [`상태 ${r.status}`];
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log(`\n✓ 배포 뒤 점검 모두 통과 (${results.length}건)`);
    process.exit(0);
  }
  console.log(`\n✗ 배포 뒤 점검 실패 ${failed.length}건 / ${results.length}건`);
  // 분석 스크립트만 실패했으면 3, 그 밖의 실패가 있으면 1
  process.exit(failed.every((r) => r.name === ANALYTICS_ITEM) ? 3 : 1);
}

main();
