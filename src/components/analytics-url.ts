// 사용 분석으로 보내는 주소에서 쿼리 문자열과 조각을 지운다(4.10-13). 거르기 조건(계정·카테고리 id, 월)이 담기기 때문이다.
// 경로에는 사용자 데이터가 들어가지 않는다(화면 경로는 고정 이름뿐이다).
export function stripQuery(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.toString();
}
