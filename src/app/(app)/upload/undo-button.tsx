"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/money";
import { TransactionTags } from "@/components/transaction-tags";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { TouchedTransaction } from "@/lib/import";
import { undoImportAction } from "./actions";

// 업로드 되돌리기(4.3-5). 먼저 묻고, 그 업로드 뒤 손댄 거래가 있으면 그 목록을 보여 주고 한 번 더 확인받는다.
export function UndoButton({ importId, label, isDemo }: { importId: number; label: string; isDemo: boolean }) {
  const [touched, setTouched] = useState<TouchedTransaction[] | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  const undo = async (confirmedIds: number[] = []) => {
    const r = await undoImportAction(importId, confirmedIds);
    if ("ok" in r) return r.message;
    if (r.status === "needs_confirm") {
      setTouched(r.touched);
      return;
    }
    setTouched(null);
  };

  if (isDemo) {
    return (
      <>
        <Button size="xs" variant="outline" onClick={() => setDemoOpen(true)}>
          되돌리기
        </Button>
        <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>로그인하면 할 수 있습니다.</DialogTitle>
              <DialogDescription>데모에서는 바꿀 수 없습니다.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDemoOpen(false)}>
                닫기
              </Button>
              <Button render={<a href="/api/auth/login" />}>구글로 로그인</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <ConfirmDialog
        trigger={
          <Button size="xs" variant="outline">
            되돌리기
          </Button>
        }
        title="이 업로드를 되돌리시겠습니까?"
        description={`${label} 업로드로 들어온 거래를 지우고, 올리기 전 거래와 잔액으로 돌아갑니다.`}
        confirmLabel="되돌리기"
        destructive
        onConfirm={() => undo()}
      />
      <ConfirmDialog
        open={touched != null}
        onOpenChange={(o) => !o && setTouched(null)}
        wide
        title={`업로드 뒤 손댄 거래 ${formatNumber(touched?.length ?? 0)}건이 있습니다`}
        description="되돌리면 이 업로드 거래에 한 수정·삭제 표시는 사라집니다. 업로드 뒤에 직접 넣은 거래는 남습니다."
        confirmLabel="그래도 되돌리기"
        destructive
        onConfirm={() => undo(touched?.map((t) => t.id) ?? [])}
      >
        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableBody>
              {touched?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="w-24 tabular-nums">{t.date}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{t.description}</span>
                      <TransactionTags row={t} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={t.amount} signed={!t.deletedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ConfirmDialog>
    </>
  );
}
