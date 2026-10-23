"use client";

// Vercel Web Analytics(4.10-13). 쿠키 없이 익명 방문을 센다. 개발 서버에서는 콘솔 로그만 남기고 보내지 않는다(패키지 기본 동작).
import { Analytics } from "@vercel/analytics/next";
import { stripQuery } from "./analytics-url";

export function SiteAnalytics() {
  return <Analytics debug={false} beforeSend={(event) => ({ ...event, url: stripQuery(event.url) })} />;
}
