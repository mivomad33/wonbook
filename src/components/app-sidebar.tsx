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
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/components/app-nav";
import { cn } from "@/lib/utils";

// 왼쪽 고정 사이드바(design.md 3.1). footer는 마지막 업로드 시각이다. DB를 읽는 서버 컴포넌트라 레이아웃이 넘긴다.
export function AppSidebar({ footer }: { footer: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <Sidebar collapsible="none" className="sticky top-0 h-svh border-r">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <div className="px-2 text-[15px] font-bold">원북</div>
        <Link href="/upload" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
          파일 올리기
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={isActive(item.href)}
                  className={cn(!item.ready && "text-muted-foreground/70")}
                  render={<Link href={item.href} />}
                >
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
