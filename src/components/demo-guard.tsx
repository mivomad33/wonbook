"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// 데모의 읽기 전용 안내(4.5-3). 쓰는 동작의 버튼을 누르면 서버 동작을 부르지 않고 로그인 안내를 띄운다.
// 서버 동작도 데모를 따로 거부한다(actionUser). 이것은 화면에서 먼저 막아 안내하는 것이다.
type DemoGuard = {
  isDemo: boolean;
  // 로그인 안내를 띄운다.
  showLoginPrompt: () => void;
  // 데모면 안내를 띄우고 fn을 부르지 않는다. 데모가 아니면 fn을 그대로 부른다.
  guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
};

const DemoGuardContext = createContext<DemoGuard>({ isDemo: false, showLoginPrompt: () => {}, guard: (fn) => fn });

export function DemoGuardProvider({ isDemo, children }: { isDemo: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const showLoginPrompt = useCallback(() => setOpen(true), []);
  const value = useMemo<DemoGuard>(
    () => ({
      isDemo,
      showLoginPrompt,
      guard:
        (fn) =>
        (...args) => {
          if (isDemo) showLoginPrompt();
          else fn(...args);
        },
    }),
    [isDemo, showLoginPrompt],
  );

  return (
    <DemoGuardContext.Provider value={value}>
      {children}
      {isDemo && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>로그인하면 할 수 있습니다.</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">데모는 둘러보기만 할 수 있습니다.</p>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>닫기</DialogClose>
              {/* 인증 경로라 페이지 이동으로 연다. */}
              <a href="/api/auth/login" className={cn(buttonVariants())}>
                구글로 로그인
              </a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </DemoGuardContext.Provider>
  );
}

export const useDemoGuard = () => useContext(DemoGuardContext);
