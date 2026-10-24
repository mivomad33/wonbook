"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { UploadIcon } from "lucide-react";
import { ADMIN_NAV, NAV_ITEMS, SETTINGS_NAV } from "@/components/app-nav";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

// 왼쪽 고정 사이드바(design.md 3.1). 휴대폰 폭에서는 접히는 메뉴가 된다(4.6-3).
// footer는 마지막 업로드 시각이다. DB를 읽는 서버 컴포넌트라 레이아웃이 넘긴다.
export function AppSidebar({ footer, isAdmin, isDemo }: { footer: ReactNode; isAdmin: boolean; isDemo: boolean }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // 휴대폰에서 메뉴를 고르면 접는다.
  const close = () => isMobile && setOpenMobile(false);
  const items = [
    ...NAV_ITEMS,
    ...(isDemo ? [] : [SETTINGS_NAV]),
    ...(isAdmin ? [ADMIN_NAV] : []),
  ];

  return (
    <Sidebar className="md:sticky md:top-0 md:h-svh">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <Link href="/home" className="flex items-center gap-2 px-2 text-[15px] font-bold" onClick={close}>
          <LogoMark size={22} />
          Wonbook
        </Link>
        <Link href="/upload" className={cn(buttonVariants({ size: "lg" }), "w-full")} onClick={close}>
          <UploadIcon />
          파일 올리기
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton isActive={isActive(item.href)} render={<Link href={item.href} onClick={close} />}>
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-5 pb-4 text-xs text-muted-foreground">{footer}</SidebarFooter>
    </Sidebar>
  );
}
