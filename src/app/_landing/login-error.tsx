"use client";

import { useSearchParams } from "next/navigation";

// 구글 로그인이 실패하면 콜백이 /?error=login으로 보낸다. 소개 화면은 정적이라 주소는 브라우저에서 읽는다.
export function LoginError() {
  const params = useSearchParams();
  if (params.get("error") !== "login") return null;
  return (
    <p role="alert" className="mt-4 text-sm text-destructive">
      로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.
    </p>
  );
}
