"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// 화면 조건은 URL 쿼리로 둔다(design.md 2.2). 받은 값만 바꾸고(null이면 지운다) 나머지 쿼리는 유지한 채 이동한다.
export function useQueryUpdate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };
}
