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
