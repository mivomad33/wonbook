"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

// 휴대폰 폭에서는 사이드바가 접히는 메뉴가 된다(4.6-3). 메뉴를 여는 버튼과 앱 이름을 위쪽에 둔다.
export function MobileTopBar() {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
      <SidebarTrigger aria-label="메뉴 열기" />
      <span className="text-[15px] font-bold">Wonbook</span>
    </div>
  );
}
