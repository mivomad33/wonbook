"use client";

import { useState, useTransition, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { classifyErrorMessage } from "@/lib/categorize/messages";
import type { ReclassifyOthersResult } from "@/lib/categorize";
import { formatNumber } from "@/lib/format";
import { reclassifyOthersAction } from "./actions";

function resultMessage(r: ReclassifyOthersResult) {
  const done =
    r.asked === 0
      ? "다시 물을 가맹점이 없습니다."
      : r.changedKeys > 0
        ? `가맹점 ${formatNumber(r.asked)}곳 중 ${formatNumber(r.changedKeys)}곳을 옮겼습니다(거래 ${formatNumber(r.changedTransactions)}건).`
        : `가맹점 ${formatNumber(r.asked)}곳을 물었지만 옮길 곳이 없었습니다.`;
  return [r.asked > 0 || !r.error ? done : null, r.error && classifyErrorMessage(r.error)].filter(Boolean).join(" ");
}

// "기타" 다시 묻기 본문(5단계 파일 8장, 결정 F9). 카테고리 추가 대화상자의 다음 단계와 화면 위 버튼이 같이 쓴다.
export function ReclassifyOthersBody({ count, title }: { count: number; title: string }) {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const run = () => startTransition(async () => setMessage(resultMessage(await reclassifyOthersAction())));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          AI가 &quot;기타 지출&quot;·&quot;기타 수입&quot;으로 분류한 가맹점 {formatNumber(count)}곳을 지금 카테고리 목록으로 다시 물을까요?
          답이 바뀐 가맹점만 옮기고, 직접 고친 분류는 그대로 둡니다. Claude API를 불러 비용이 조금 듭니다(1센트 안팎).
        </DialogDescription>
      </DialogHeader>
      {message && <p>{message}</p>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>{message ? "닫기" : "나중에"}</DialogClose>
        {/* 실패하면 다시 누를 수 있다. */}
        <Button disabled={pending} onClick={run}>
          {pending ? "분류 중…" : message ? "다시 묻기" : "다시 분류"}
        </Button>
      </DialogFooter>
    </>
  );
}

// 화면 위의 "기타 다시 분류" 버튼. 추가할 때 미뤘거나 실패했을 때 다시 쓴다.
export function ReclassifyOthersButton({ count, trigger }: { count: number; trigger: ReactElement }) {
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog onOpenChange={(open) => open && setFormKey((k) => k + 1)}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <ReclassifyOthersBody key={formKey} count={count} title="기타 다시 분류" />
      </DialogContent>
    </Dialog>
  );
}
