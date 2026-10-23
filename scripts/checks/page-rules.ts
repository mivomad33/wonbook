// 공개 페이지(검색엔진 수집 대상) HTML의 규칙(4.6-8, 4.6-10, 4.6-11). 배포 결과물 검사와 배포 뒤 점검이 같이 쓴다.
// 기대값은 앱의 원본 모듈(config, site-meta, robots.txt, sitemap)에서 만든다. 페이지마다 값을 하드코딩하지 않는다.
import { SITE_NAME, SITE_URL } from "@/config";
import { LANDING_TITLE, OG_IMAGE, PRIVACY_TITLE, SITE_DESCRIPTION } from "@/app/site-meta";
import { GET as robotsGet } from "@/app/robots.txt/route";
import sitemap from "@/app/sitemap";

/** 문서가 제목을 정한 공개 페이지. 반드시 있어야 한다. */
export const PAGE_TITLES: Record<string, string> = {
  "/": LANDING_TITLE,
  "/privacy": PRIVACY_TITLE,
};
export const PUBLIC_PATHS = Object.keys(PAGE_TITLES);
/** 공개 페이지가 걸어야 하는 아이콘 파일(Next.js 아이콘 파일 규칙) */
export const ICON_PATHS = ["/favicon.ico", "/icon.svg", "/apple-icon.png"];
/** og:image의 경로(정적 파일 public/og.png) */
export const OG_IMAGE_PATH = new URL(OG_IMAGE.url).pathname;
/** 개발 전용 테스트 로그인 경로의 흔적(결과물·운영 사이트에 없어야 한다, 4.1-5) */
export const DEV_LOGIN_MARKER = "dev-login";

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`;

/** robots.txt 기대 내용(앱의 경로 처리기가 만드는 그대로) */
export async function expectedRobots(): Promise<string> {
  return robotsGet().text();
}
export const SITEMAP_URLS = sitemap().map((e) => e.url);

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** 태그 하나의 속성 값 목록 */
function values(html: string, tag: "meta" | "link", key: "name" | "property" | "rel", keyValue: string, attr: "content" | "href"): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))) {
    const t = m[0];
    const k = new RegExp(`\\b${key}="([^"]*)"`).exec(t)?.[1];
    if (k !== keyValue) continue;
    out.push(decode(new RegExp(`\\b${attr}="([^"]*)"`).exec(t)?.[1] ?? ""));
  }
  return out;
}

export function isNoindex(html: string): boolean {
  return values(html, "meta", "name", "robots", "content").some((v) => v.includes("noindex"));
}

/** 아이콘 링크 주소(쿼리 포함) */
export function iconHrefs(html: string): string[] {
  return [...values(html, "link", "rel", "icon", "href"), ...values(html, "link", "rel", "shortcut icon", "href"), ...values(html, "link", "rel", "apple-touch-icon", "href")];
}

/** 공개 페이지 HTML이 규칙에 맞는지. 어긋난 항목을 돌려준다(값이 아니라 항목 이름). */
export function checkPublicPage(html: string, path: string): string[] {
  const bad: string[] = [];
  const once = (label: string, list: string[], expected?: string) => {
    if (list.length !== 1) bad.push(`${label} ${list.length}개(1개여야 합니다)`);
    else if (expected !== undefined && list[0] !== expected) bad.push(`${label} 값이 다릅니다`);
  };
  const titles = [...html.matchAll(/<title\b[^>]*>([^<]*)<\/title>/g)].map((m) => decode(m[1]));
  once("title", titles, PAGE_TITLES[path]);
  if (!/<html\b[^>]*\blang="ko"/.test(html)) bad.push('<html lang="ko">가 없습니다');
  if (isNoindex(html)) bad.push("noindex가 있습니다");
  const url = absoluteUrl(path);
  once("description", values(html, "meta", "name", "description", "content"), SITE_DESCRIPTION);
  once("canonical", values(html, "link", "rel", "canonical", "href"), url);
  const og = (p: string, v: string) => once(`og:${p}`, values(html, "meta", "property", `og:${p}`, "content"), v);
  og("title", SITE_NAME);
  og("description", SITE_DESCRIPTION);
  og("url", url);
  og("site_name", SITE_NAME);
  og("locale", "ko_KR");
  og("type", "website");
  og("image", OG_IMAGE.url);
  og("image:width", String(OG_IMAGE.width));
  og("image:height", String(OG_IMAGE.height));
  og("image:alt", OG_IMAGE.alt);
  const tw = (p: string, v: string) => once(`twitter:${p}`, values(html, "meta", "name", `twitter:${p}`, "content"), v);
  tw("card", "summary_large_image");
  tw("title", SITE_NAME);
  tw("description", SITE_DESCRIPTION);
  tw("image", OG_IMAGE.url);
  if (!OG_IMAGE.url.startsWith("https://")) bad.push("og:image가 절대 주소가 아닙니다");
  const icons = iconHrefs(html).map((h) => h.split("?")[0]);
  for (const need of ICON_PATHS) if (!icons.includes(need)) bad.push(`아이콘 링크 ${need}가 없습니다`);
  return bad;
}

/** 소개 화면의 구조화 데이터(JSON-LD) */
export function checkJsonLd(html: string): string[] {
  const blocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) return [`JSON-LD ${blocks.length}개(1개여야 합니다)`];
  try {
    const j = JSON.parse(blocks[0][1]);
    const bad: string[] = [];
    const eq = (label: string, got: unknown, want: unknown) => got !== want && bad.push(`JSON-LD ${label} 값이 다릅니다`);
    eq("@type", j["@type"], "WebApplication");
    eq("name", j.name, SITE_NAME);
    eq("description", j.description, SITE_DESCRIPTION);
    eq("url", j.url, absoluteUrl("/"));
    eq("applicationCategory", j.applicationCategory, "FinanceApplication");
    eq("operatingSystem", j.operatingSystem, "Web");
    eq("inLanguage", j.inLanguage, "ko");
    eq("offers.price", Number(j.offers?.price), 0);
    eq("offers.priceCurrency", j.offers?.priceCurrency, "KRW");
    return bad;
  } catch {
    return ["JSON-LD를 JSON으로 읽을 수 없습니다"];
  }
}

const normLines = (s: string) => s.replace(/\r\n/g, "\n").trim().split("\n").map((l) => l.trim()).join("\n");

export async function checkRobots(text: string): Promise<string[]> {
  return normLines(text) === normLines(await expectedRobots()) ? [] : ["robots.txt 내용이 다릅니다"];
}

export function checkSitemap(xml: string): string[] {
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1].trim()));
  return JSON.stringify(locs) === JSON.stringify(SITEMAP_URLS) ? [] : ["sitemap.xml 주소 목록이 다릅니다"];
}
