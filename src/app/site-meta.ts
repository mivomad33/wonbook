// 소개 화면·처리방침의 제목·설명과 링크 미리보기 값(4.6-10, 4.6-11). 배포 결과물 검사·배포 뒤 점검도 이 값으로 맞춰 본다.
import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/config";

export const SITE_DESCRIPTION =
  "금융사에서 내려받은 거래 내역 파일을 올리면 입력, 분류, 잔액 맞추기까지 알아서 끝나는 웹 가계부입니다. 지금은 하나은행, 국민은행, 카카오뱅크, 하나카드, 국민카드, 한국투자증권 파일을 읽습니다.";
export const LANDING_TITLE = `${SITE_NAME} - 은행 파일만 올리면 가계부 정리 끝`;
export const PRIVACY_TITLE = `개인정보 처리방침 - ${SITE_NAME}`;
export const OG_IMAGE = {
  url: `${SITE_URL}/og.png`,
  width: 1200,
  height: 630,
  alt: "Wonbook - 은행 파일만 올리면 가계부 정리 끝. 업로드 결과 화면 예시",
};

/**
 * 검색엔진 소유 확인 값(Google Search Console, 네이버 서치어드바이저, 다음 웹마스터도구). 원래 페이지에 공개되는 값이다.
 * Google·네이버는 소개 화면 <meta>로, 다음은 robots.txt 맨 아래 줄로 확인한다. Bing은 Search Console에서 가져와 값이 없다.
 * 배포 검사 기준(scripts/checks/page-rules.ts)에도 따로 적혀 있어, 바꿀 때 함께 고친다.
 */
export const SITE_VERIFICATION = {
  google: "mhxcHCnGlus8pgaYc_t7hBGoj3cvPOkED1D6dSxu30M",
  naver: "f8f8ac44e429c3997d54c5cbc0d0d63749221f66",
  daumRobotsLine: "#DaumWebMasterTool:7db491f604e320fb49d32377b35b052df1f9f3574eb7a8e83f2b70c2c260999c:7P03ihYqiZrb12N7WKj+xw==",
};

/** 페이지마다 같은 미리보기 태그를 쓰고 주소만 바꾼다. */
export function pageMetadata(path: string, title: string): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title: { absolute: title },
    description: SITE_DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: SITE_NAME, locale: "ko_KR", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
  };
}
