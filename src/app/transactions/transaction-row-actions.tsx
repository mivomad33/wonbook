"use client";

import { useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { TransactionListItem } from "@/lib/transactions";
import { setTransactionDeletedAction } from "./actions";
import { useTransactionEditor } from "./transaction-editor";

// 수정·삭제 표시 버튼. 삭제 표시한 거래는 되살리기 버튼만 둔다(2단계 파일 2.3, 3.4).
export function TransactionRowActions({ row }: { row: TransactionListItem }) {
  const openEditor = useTransactionEditor();
  const [pending, startTransition] = useTransition();

  if (row.deletedAt) {
    return (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() => startTransition(async () => void (await setTransactionDeletedAction(row.id, false)))}
        >
          되살리기
        </Button>
      </div>
    );
  }
  // 보정 거래는 고치거나 삭제 표시할 수 없다(4단계 파일 5장).
  if (row.kind === "adjustment") return null;

  const isTransfer = row.kind === "transfer";
  const notes = [
    isTransfer && row.transferPeerId != null && "이체 두 건이 함께 삭제 표시됩니다.",
    row.source === "upload" && "업로드한 거래라 다음에 이 기간 파일을 올릴 때 덮어쓸지 확인을 받습니다.",
    "\"삭제한 거래 보기\"에서 되살릴 수 있습니다.",
  ].filter(Boolean);

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="xs" onClick={() => openEditor({ type: isTransfer ? "transfer" : "transaction", row })}>
        수정
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="xs">
            삭제
          </Button>
        }
        title={isTransfer ? "이체를 삭제 표시할까요?" : "거래를 삭제 표시할까요?"}
        description={notes.join(" ")}
        confirmLabel="삭제"
        onConfirm={() => setTransactionDeletedAction(row.id, true)}
      />
    </div>
  );
}

// 거래 추가·이체 추가 버튼(2단계 파일 2.1)
export function NewTransactionButtons() {
  const openEditor = useTransactionEditor();
  return (
    <>
      <Button variant="outline" onClick={() => openEditor({ type: "transfer" })}>
        이체 추가
      </Button>
      <Button onClick={() => openEditor({ type: "transaction" })}>거래 추가</Button>
    </>
  );
}
