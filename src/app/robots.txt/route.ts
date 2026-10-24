// robots.txt(4.6-11). 소개 화면과 개인정보 처리방침만 수집하고, 로그인 뒤 화면·데모·인증·API는 막는다.
// 맨 아래 줄은 다음 웹마스터도구 소유 확인 줄이다.
import { SITE_URL } from "@/config";
import { SITE_VERIFICATION } from "@/app/site-meta";

const DISALLOW = ["/home", "/monthly", "/transactions", "/upload", "/accounts", "/categories", "/settings", "/admin", "/demo", "/api/"];

export function GET(): Response {
  const body = ["User-agent: *", "Allow: /$", "Allow: /privacy", ...DISALLOW.map((p) => `Disallow: ${p}`), "", `Sitemap: ${SITE_URL}/sitemap.xml`, "", SITE_VERIFICATION.daumRobotsLine, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
