"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/money";
import { ReclassifyButton } from "@/components/reclassify-button";
import { TransactionTags } from "@/components/transaction-tags";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ClassifyError, classifyErrorMessage } from "@/lib/categorize/messages";
import { formatNumber } from "@/lib/format";
import type { UploadFileResult } from "@/lib/import/upload";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { uploadFilesAction } from "./actions";

// 고른 파일과 그 결과. 확인 뒤 같은 File을 다시 보낸다(결정 D8).
type Entry = { file: File; result: UploadFileResult };
type Resend = { index: number; confirmedIds?: number[]; createAccount?: boolean };

// 파일 놓는 곳, 이번 결과, 손댄 거래 확인 대화상자(3단계 파일 7.1·7.2)
export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [requestError, setRequestError] = useState<string>();
  // 반영한 파일에 미분류가 남은 이유(5단계 파일 6장)
  const [classifyError, setClassifyError] = useState<ClassifyError | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // 파일과 파일마다의 정보를 같은 순서로 보낸다.
  const send = async (files: { file: File; confirmedIds?: number[]; createAccount?: boolean }[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append("file", f.file));
    formData.append(
      "meta",
      JSON.stringify(files.map((f) => ({ confirmedIds: f.confirmedIds ?? [], createAccount: f.createAccount ?? false }))),
    );
    return uploadFilesAction(formData);
  };

  const uploadNew = (files: File[]) => {
    if (files.length === 0 || pending) return;
    startTransition(async () => {
      const result = await send(files.map((file) => ({ file })));
      if (!result.ok) {
        setRequestError(result.message);
        setEntries([]);
        return;
      }
      setRequestError(undefined);
      setClassifyError(result.classifyError);
      setEntries(result.files.map((r, i) => ({ file: files[i], result: r })));
      if (result.files.some((r) => r.status === "needs_confirm")) setConfirmOpen(true);
    });
  };

  // 일부 파일만 다시 보내고 그 자리의 결과를 바꾼다. 같은 계좌 파일 오류는 요청 전체 오류로 보여준다.
  const resend = async (items: Resend[]): Promise<UploadFileResult[] | string> => {
    const result = await send(items.map((it) => ({ file: entries[it.index].file, ...it })));
    if (!result.ok) return result.message;
    if (result.files.some((r) => r.status === "applied")) setClassifyError(result.classifyError);
    setEntries((prev) => prev.map((e, i) => {
      const at = items.findIndex((it) => it.index === i);
      return at < 0 ? e : { ...e, result: result.files[at] };
    }));
    return result.files;
  };

  const needsConfirm = entries
    .map((e, index) => ({ ...e, index }))
    .filter((e): e is Entry & { index: number; result: Extract<UploadFileResult, { status: "needs_confirm" }> } => e.result.status === "needs_confirm");
  const touchedCount = needsConfirm.reduce((sum, e) => sum + e.result.touched.length, 0);

  const confirmOverwrite = async () => {
    const files = await resend(needsConfirm.map((e) => ({ index: e.index, confirmedIds: e.result.touched.map((t) => t.id) })));
    if (typeof files === "string") return files;
    // 그 사이 손댄 거래가 늘었으면 새 목록으로 다시 묻는다(3단계 파일 5.2).
    if (files.some((r) => r.status === "needs_confirm")) return "그 사이 손댄 거래가 바뀌었습니다. 목록을 다시 확인해 주세요.";
  };

  const createAndUpload = (index: number) =>
    startTransition(async () => {
      const files = await resend([{ index, createAccount: true }]);
      if (typeof files === "string") setRequestError(files);
    });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    uploadNew([...e.dataTransfer.files]);
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex h-32 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:bg-muted/50",
          dragging && "border-primary bg-muted",
          pending && "cursor-wait",
        )}
      >
        {pending ? (
          <span>읽는 중…</span>
        ) : (
          <>
            <span className="font-medium text-foreground">금융사 파일을 끌어다 놓거나 눌러서 고르세요</span>
            <span>여러 개를 한 번에 올릴 수 있습니다. 금융사와 계정은 파일 내용으로 찾습니다.</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          uploadNew([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {requestError && <p className="text-destructive">{requestError}</p>}

      {entries.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold text-muted-foreground">이번 결과</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>파일</TableHead>
                <TableHead>금융사</TableHead>
                <TableHead>계정</TableHead>
                <TableHead>기간</TableHead>
                <TableHead className="text-right">넣은 수</TableHead>
                <TableHead className="text-right">지운 수</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(({ result: r }, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-56 truncate">{r.fileName}</TableCell>
                  <TableCell>{r.institution ? INSTITUTION_LABELS[r.institution] : ""}</TableCell>
                  <TableCell>
                    {r.status !== "error" && (
                      <Link href={`/transactions?account=${r.account.id}&month=${r.period.end.slice(0, 7)}`} className="hover:underline">
                        {r.account.name}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.period && `${r.period.start} ~ ${r.period.end}`}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.status === "applied" && formatNumber(r.insertedCount)}
                    {r.status === "needs_confirm" && <span className="text-muted-foreground">{formatNumber(r.insertCount)}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.status === "applied" && formatNumber(r.deletedCount)}
                    {r.status === "needs_confirm" && <span className="text-muted-foreground">{formatNumber(r.deleteCount)}</span>}
                  </TableCell>
                  <TableCell>
                    {r.status === "applied" && <span className="text-green-700">반영함{r.createdAccount && "(계정 만듦)"}</span>}
                    {/* 이번 반영에서 새로 생긴 보정만 보여준다(4단계 파일 6.2). */}
                    {r.status === "applied" && r.newAdjustments.count > 0 && (
                      <div className="text-xs whitespace-normal text-amber-700">
                        보정 {formatNumber(r.newAdjustments.count)}건, 합계 <Money value={r.newAdjustments.total} plus />
                      </div>
                    )}
                    {r.status === "applied" && <CategoryLine counts={r.categories} />}
                    {r.status === "needs_confirm" && (
                      <Button variant="link" size="xs" className="h-auto px-0 text-amber-700" disabled={pending} onClick={() => setConfirmOpen(true)}>
                        확인 필요
                      </Button>
                    )}
                    {r.status === "error" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-destructive">{r.message}</span>
                        {r.newAccount && (
                          <Button size="xs" variant="outline" disabled={pending} onClick={() => createAndUpload(i)}>
                            계정 만들고 올리기
                          </Button>
                        )}
                      </div>
                    )}
                    {r.status === "error" && r.newAccount && (
                      <div className="text-xs text-muted-foreground">만들 계정: {r.newAccount.name}</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {classifyError && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-amber-700">
              <span>{classifyErrorMessage(classifyError)}</span>
              <ReclassifyButton />
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen && needsConfirm.length > 0}
        onOpenChange={setConfirmOpen}
        wide
        title={`직접 손댄 거래 ${formatNumber(touchedCount)}건이 지워집니다`}
        description="덮어쓰면 파일 내용으로 바뀌고, 고친 내용은 다시 붙지 않습니다. 덮어쓰기 직전에 DB를 백업합니다."
        confirmLabel="덮어쓰기"
        destructive
        onConfirm={confirmOverwrite}
      >
        <div className="max-h-[50vh] overflow-y-auto">
          {needsConfirm.map(({ index, result }) => (
            <div key={index} className="mb-3">
              <div className="mb-1 font-medium">
                {result.account.name} <span className="font-normal text-muted-foreground">· {result.fileName}</span>
              </div>
              <Table>
                <TableBody>
                  {result.touched.map((t) => (
                    <TableRow key={t.id} className={cn(t.deletedAt && "text-muted-foreground")}>
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
          ))}
        </div>
      </ConfirmDialog>
    </div>
  );
}

// "분류: 저장된 분류 N · AI N · 미분류 N"(5단계 파일 6장). 미분류가 0이면 빼고, 분류할 거래가 없으면 줄을 뺀다.
function CategoryLine({ counts }: { counts: Extract<UploadFileResult, { status: "applied" }>["categories"] }) {
  if (counts.saved + counts.ai + counts.pending === 0) return null;
  const parts = [`저장된 분류 ${formatNumber(counts.saved)}`, `AI ${formatNumber(counts.ai)}`];
  if (counts.pending > 0) parts.push(`미분류 ${formatNumber(counts.pending)}`);
  return <div className="text-xs whitespace-normal text-muted-foreground">분류: {parts.join(" · ")}</div>;
}
