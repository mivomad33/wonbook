"use client";

// Vercel Web Analytics(4.10-13). 쿠키 없이 익명 방문을 센다. 개발 서버에서는 보내지 않는다(패키지 기본 동작).
// 개발 서버의 콘솔 기록도 debug={false}로 끈다.
import { Analytics } from "@vercel/analytics/next";
import { stripQuery } from "./analytics-url";

export function SiteAnalytics() {
  return <Analytics debug={false} beforeSend={(event) => ({ ...event, url: stripQuery(event.url) })} />;
}
