import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    cacheComponents: true,
    partialPrefetching: true,
    // 개발 서버(next dev)에서만 *.dev.ts를 경로 파일로 쓴다. 테스트 로그인 같은 개발 전용 경로가 빌드 결과물에 들어가지 않게 한다(4.1-5).
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.ts", "tsx", "ts"] : ["tsx", "ts"],
    // E2E 테스트는 확인용 개발 서버와 함께 띄울 수 있게 다른 폴더를 쓴다(next dev는 폴더마다 하나만 뜬다).
    distDir: process.env.NEXT_DIST_DIR || ".next",
    // 업로드는 브라우저가 파일을 읽어 거래만 나눠 보낸다(4.3-1). 한 요청은 Vercel 한도 4.5MB보다 작게 보낸다.
    experimental: {
      serverActions: {
        bodySizeLimit: "4mb",
      },
    },
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
    async headers() {
      // 로그인 뒤 화면, 데모, API는 검색엔진이 수집하지 않는다(robots.txt로도 막는다, 4.6-11).
      const noindex = [{ key: "X-Robots-Tag", value: "noindex" }];
      return ["/home", "/monthly", "/transactions", "/upload", "/accounts", "/categories", "/settings", "/admin", "/demo", "/api/:path*"].map((source) => ({ source, headers: noindex }));
    },
  };
}
