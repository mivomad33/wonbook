import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/auth/current";
import { AppFooter } from "@/components/app-footer";
import { AppSidebar } from "@/components/app-sidebar";
import { DemoBanner } from "@/components/demo-banner";
import { DemoGuardProvider } from "@/components/demo-guard";
import { DevDbBadge } from "@/components/dev-db-badge";
import { LastImport } from "@/components/last-import";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

// 로그인 뒤 화면과 데모는 검색엔진이 수집하지 않는다(4.6-11).
export const metadata: Metadata = { robots: { index: false, follow: false } };

// 사용자(또는 데모)를 확인한 뒤 화면을 그린다. 로그인하지 않았으면 requireUser가 소개 화면으로 보낸다.
async function Shell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <SidebarProvider style={{ "--sidebar-width": "220px" } as React.CSSProperties}>
      <AppSidebar
        isAdmin={user.isAdmin}
        isDemo={user.isDemo}
        footer={
          <Suspense>
            <LastImport userId={user.id} />
          </Suspense>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        {user.isDemo && <DemoBanner />}
        <main className="min-w-0 flex-1 px-4 py-5 md:px-7">
          <DemoGuardProvider isDemo={user.isDemo}>{children}</DemoGuardProvider>
        </main>
        <AppFooter />
      </div>
      <DevDbBadge />
    </SidebarProvider>
  );
}

function ShellLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground" role="status">
      불러오는 중…
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <TooltipProvider>
      {/* 사용자를 확인하는 동안(쉬던 DB가 깨어나는 동안 포함) 빈 화면 대신 로딩 표시를 보인다(4.10-5). */}
      <Suspense fallback={<ShellLoading />}>
        <Shell>{children}</Shell>
      </Suspense>
    </TooltipProvider>
  );
}
