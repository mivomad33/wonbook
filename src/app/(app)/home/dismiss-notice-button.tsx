"use client";

import { useState, useTransition } from "react";
import { useDemoGuard } from "@/components/demo-guard";
import { Button } from "@/components/ui/button";
import { dismissAdjustmentNoticeAction } from "../actions";

// 보정 알림의 "닫기"(4단계 파일 6.3). 닫은 시각을 저장하는 쓰기라 데모에서는 로그인 안내를 띄운다.
export function DismissNoticeButton() {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { guard } = useDemoGuard();
  const dismiss = guard(() => startTransition(async () => setError((await dismissAdjustmentNoticeAction()) ?? undefined)));

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={dismiss}>
        닫기
      </Button>
    </span>
  );
}
