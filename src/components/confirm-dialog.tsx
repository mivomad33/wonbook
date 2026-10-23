"use client";

import { useState, useTransition, type ReactElement, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// 확인 대화상자(2단계 파일 4장). 계정 삭제, 거래 삭제 표시, 3단계 덮어쓰기 확인이 쓴다.
// onConfirm이 오류 문구를 돌려주면 대화상자를 닫지 않고 보여준다.
// trigger 없이 open·onOpenChange로 바깥에서 열 수도 있다(업로드 결과를 받은 뒤 여는 덮어쓰기 확인).
// children은 설명 아래에 넣는 표 같은 본문이고, wide면 대화상자를 넓힌다.
export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  wide?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<string | void>;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(undefined);
      }}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent className={cn(wide && "data-[size=default]:max-w-2xl data-[size=default]:sm:max-w-2xl")}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && <p className="text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const message = await onConfirm();
                if (message) setError(message);
                else setOpen(false);
              })
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
