// 앱 전체 설정값. 비밀이 아닌 값은 코드 기본값으로 두고, 비밀 값은 환경 변수(.env.local, Vercel Production)에서 읽는다.
export const SITE_URL = "https://wonbook.vercel.app";
export const SITE_NAME = "Wonbook";
export const CONTACT_EMAIL = "mivomad33@gmail.com";
export const REPO_URL = "https://github.com/mivomad33/wonbook";

export const isDev = process.env.NODE_ENV === "development";

/** 관리자 이메일(4.1-4). 값은 코드에 두지 않고 환경 변수에서만 읽는다. */
export function adminEmail(): string | null {
  const v = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return v ? v : null;
}
