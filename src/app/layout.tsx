import type { Metadata } from "next";
import { SiteAnalytics } from "@/components/analytics";
import { SITE_NAME, SITE_URL } from "@/config";
import { OG_IMAGE, SITE_DESCRIPTION } from "./site-meta";
import "./globals.css";

// 모든 페이지의 기본값. 소개 화면과 처리방침은 자기 제목·canonical을 덮어쓰고(site-meta.ts), 로그인 뒤 화면은 noindex다.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s - ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "ko_KR", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="antialiased">
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
