import type { Metadata } from "next";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { LastImport } from "@/components/last-import";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "원북",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="antialiased">
      <body>
        <TooltipProvider>
          <SidebarProvider style={{ "--sidebar-width": "220px" } as React.CSSProperties}>
            <AppSidebar
              footer={
                <Suspense>
                  <LastImport />
                </Suspense>
              }
            />
            <main className="min-w-0 flex-1 px-7 py-5">{children}</main>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
