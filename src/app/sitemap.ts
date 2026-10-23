// sitemap.xml(4.6-11). 소개 화면과 개인정보 처리방침만 둔다.
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/` }, { url: `${SITE_URL}/privacy` }];
}
