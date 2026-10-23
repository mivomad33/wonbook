"use client";

import { useTransition } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { AccountListItem } from "@/lib/accounts";
import { formatNumber } from "@/lib/format";
import { AccountFormDialog } from "./account-form-dialog";
import { deleteAccountAction, moveAccountAction } from "./actions";

// 같은 종류 묶음 안에서 위·아래로 옮기는 ▲▼ 버튼(2단계 파일 1.4)
export function MoveButtons({ id, isFirst, isLast }: { id: number; isFirst: boolean; isLast: boolean }) {
  const [pending, startTransition] = useTransition();
  const move = (direction: "up" | "down") => startTransition(() => moveAccountAction(id, direction));

  return (
    <div className="flex">
      <Button variant="ghost" size="icon-xs" aria-label="위로" disabled={isFirst || pending} onClick={() => move("up")}>
        <ChevronUpIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="아래로" disabled={isLast || pending} onClick={() => move("down")}>
        <ChevronDownIcon />
      </Button>
    </div>
  );
}

// 수정·삭제 버튼(2단계 파일 1.2, 1.3)
export function AccountRowActions({ account }: { account: AccountListItem }) {
  const hasData = account.allTransactionCount > 0 || account.importCount > 0;

  return (
    <div className="flex justify-end gap-1">
      <AccountFormDialog account={account} trigger={<Button variant="ghost" size="xs">수정</Button>} />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="xs">
            삭제
          </Button>
        }
        title={`"${account.name}" 계정을 지울까요?`}
        description={
          hasData
            ? `거래 ${formatNumber(account.allTransactionCount)}건(삭제 표시한 거래 포함)과 업로드 기록 ${formatNumber(account.importCount)}건이 함께 지워집니다. 되돌릴 수 없습니다.`
            : "이 계정에는 거래와 업로드 기록이 없습니다. 되돌릴 수 없습니다."
        }
        confirmLabel="삭제"
        destructive={hasData}
        onConfirm={() => deleteAccountAction(account.id)}
      />
    </div>
  );
}
