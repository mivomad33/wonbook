"use client";

import { useState, useTransition } from "react";
import { reclassifyAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { classifyErrorMessage } from "@/lib/categorize/messages";
import { formatNumber } from "@/lib/format";

// "다시 분류" 버튼(5단계 파일 5.3). 미분류 업로드 거래 전체를 분류하고 결과를 옆에 보여준다. 업로드 화면과 거래 목록(5-3)이 같이 쓴다.
export function ReclassifyButton() {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const r = await reclassifyAction();
      const done = r.saved + r.ai;
      const parts = [done > 0 ? `${formatNumber(done)}건 분류함` : "새로 분류한 거래 없음"];
      if (r.pending > 0) parts.push(`미분류 ${formatNumber(r.pending)}건 남음`);
      setMessage([parts.join(", "), r.error && classifyErrorMessage(r.error)].filter(Boolean).join(" · "));
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="xs" variant="outline" disabled={pending} onClick={run}>
        {pending ? "분류 중…" : "다시 분류"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
