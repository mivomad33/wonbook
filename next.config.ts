import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // 업로드 서버 액션은 파일 여러 개를 한 번에 받는다(3단계 파일 5.2). 기본 1MB는 국민카드 1년 치와 다른 파일을 합치면 넘을 수 있다.
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
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
};

export default nextConfig;
