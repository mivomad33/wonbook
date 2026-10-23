// E2E에서 올리는 가짜 금융사 파일. 값은 모두 지어낸 것이다. 날짜는 이번 달(한국 시간)이라 월별 화면에 나온다.
import path from "node:path";

export const FILES_DIR = path.join(process.cwd(), "test-results/e2e-files");
export const FAKE_KAKAO_PASSWORD = "e2e-fake-pass";

export const file = (name: string) => path.join(FILES_DIR, name);
export const HANA_1 = "hana-1.xlsx";
export const HANA_2 = "hana-2.xlsx";
export const KAKAO = "kakao-locked.xlsx";
export const UNSUPPORTED = "unsupported.xlsx";

export const thisMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()).slice(0, 7);
