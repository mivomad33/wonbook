"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearKakaoPasswordAction, saveKakaoPasswordAction } from "../upload/actions";
import { deleteAccountAction } from "./actions";

const MAX = 64;

// 카카오뱅크 암호 저장·바꾸기·지우기(4.3-4). 저장한 값은 보여 주지 않고 "저장됨"만 표시한다.
export function KakaoPasswordForm({ saved }: { saved: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveKakaoPasswordAction(value);
          setMessage(r.ok ? "저장했습니다." : r.message);
          if (r.ok) {
            setValue("");
            router.refresh();
          }
        });
      }}
    >
      <Label htmlFor="kakao-password-setting">{saved ? "저장됨 · 바꾸려면 새 암호를 넣으세요" : "저장된 암호 없음"}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="kakao-password-setting"
          type="password"
          autoComplete="off"
          maxLength={MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-56"
        />
        <Button type="submit" disabled={pending || value.length === 0}>
          {saved ? "바꾸기" : "저장"}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await clearKakaoPasswordAction();
                setMessage(r.ok ? "지웠습니다." : r.message);
                router.refresh();
              })
            }
          >
            지우기
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}

// 탈퇴(4.1-6). 실수를 막기 위해 한 번 더 확인하고, 떠나기 전에 내보내기로 갈 길을 함께 보여 준다.
export function DeleteAccount() {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive" className="self-start">
          탈퇴하기
        </Button>
      }
      title="정말 탈퇴하시겠습니까?"
      description={
        <>
          계정과 가계부 데이터가 모두 지워지고 되살릴 수 없습니다. 필요하면 먼저{" "}
          <a href="/api/export" className="underline" download>
            거래를 CSV로 내려받으세요
          </a>
          .
        </>
      }
      confirmLabel="탈퇴하기"
      destructive
      onConfirm={async () => {
        await deleteAccountAction();
      }}
    />
  );
}
