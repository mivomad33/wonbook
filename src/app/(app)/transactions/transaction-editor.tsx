"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { AccountOption } from "@/components/account-select";
import type { CategoryOption } from "@/components/category-select";
import { useDemoGuard } from "@/components/demo-guard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TransactionListItem } from "@/lib/transactions";
import { TransactionForm } from "./transaction-form";
import { TransferForm } from "./transfer-form";

export type EditorDefaults = {
  // 계정 하나로 거르는 중이면 그 계정(2단계 파일 3.1)
  accountId: number | null;
  // 오늘, 다른 달을 보는 중이면 그 달 1일
  date: string;
};

// row가 있으면 수정이다. 이체 행은 어느 쪽에서 열어도 이체 폼으로 연다(2단계 파일 3.3).
type Target = { type: "transaction" | "transfer"; row?: TransactionListItem };

const EditorContext = createContext<(target: Target) => void>(() => {});

// 거래 목록의 입력·수정 대화상자(2단계 파일 3장). 행마다 대화상자를 두지 않고 하나를 열어 쓴다.
export function TransactionEditor({
  accounts,
  categories,
  defaults,
  children,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaults: EditorDefaults;
  children: ReactNode;
}) {
  // 닫는 동안에도 내용이 보이도록 마지막 대상은 남겨 두고 열림 여부를 따로 둔다.
  const [target, setTarget] = useState<Target | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // 열 때마다 폼을 새로 만들어 이전 입력과 오류를 지운다.
  const [formKey, setFormKey] = useState(0);
  // 추가·수정은 쓰는 동작이라 데모에서는 폼 대신 로그인 안내를 띄운다(4.5-3).
  const { guard } = useDemoGuard();
  const open = guard((next: Target) => {
    setTarget(next);
    setIsOpen(true);
    setFormKey((k) => k + 1);
  });
  const close = () => setIsOpen(false);
  const isTransfer = target?.type === "transfer";
  const title = `${isTransfer ? "이체" : "거래"} ${target?.row ? "수정" : "추가"}`;

  return (
    <EditorContext.Provider value={open}>
      {children}
      <Dialog open={isOpen} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {target &&
            (isTransfer ? (
              <TransferForm key={formKey} accounts={accounts} row={target.row} defaults={defaults} onSaved={close} />
            ) : (
              <TransactionForm key={formKey} accounts={accounts} categories={categories} row={target.row} defaults={defaults} onSaved={close} />
            ))}
        </DialogContent>
      </Dialog>
    </EditorContext.Provider>
  );
}

export const useTransactionEditor = () => useContext(EditorContext);
