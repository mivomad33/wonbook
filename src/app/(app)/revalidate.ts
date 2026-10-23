// 서버 동작이 데이터를 바꾼 뒤 로그인 뒤 화면 전체를 다시 그린다.
// 계정·거래·카테고리는 여러 화면(자산 현황, 거래 목록, 사이드바의 마지막 업로드 등)에 보이므로 (app) 묶음 레이아웃을 통째로 다시 그린다.
// 소개 화면(/)은 정적 페이지라 넣지 않는다.
import { revalidatePath } from "next/cache";

export const revalidateApp = () => revalidatePath("/(app)", "layout");
