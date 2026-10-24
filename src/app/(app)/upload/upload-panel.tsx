"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { UploadIcon } from "lucide-react";
import { Panel } from "@/components/panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Money } from "@/components/money";
import { ReclassifyButton } from "@/components/reclassify-button";
import { TransactionTags } from "@/components/transaction-tags";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { classifyErrorMessage, classifyLimitMessage } from "@/lib/categorize/messages";
import { formatNumber } from "@/lib/format";
import type { UploadedFile, UploadRequestFile } from "@/lib/import/payload";
import { splitIntoParts } from "@/lib/import/split";
import type { UploadFileResult, UploadResult } from "@/lib/import/upload";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { commitUpload, loadKakaoPasswordAction, saveKakaoPasswordAction, stageUploadPart } from "./actions";
import { readUploadFile } from "./read-files";

// 고른 파일마다 브라우저에서 읽은 업로드 값과 결과. 확인 뒤 같은 값을 다시 보낸다(결정 D8).
// 읽지 못한 파일은 업로드 값 없이 오류 결과만 있다.
type Entry = { name: string; uploaded?: UploadedFile; result: UploadFileResult };
type Resend = { index: number; confirmedIds?: number[]; createAccount?: boolean };
type ApplyOk = Extract<UploadResult, { ok: true }>;

const KAKAO_PASSWORD_MAX = 64;

// 업로드 값을 조각으로 나눠 보내고 한 번에 반영한다(요청 하나는 4.5MB보다 작게, 4.3-2).
async function send(files: UploadRequestFile[]): Promise<UploadResult> {
  const token = crypto.randomUUID().replaceAll("-", "");
  const parts = splitIntoParts(JSON.stringify(files));
  for (const [i, body] of parts.entries()) {
    const r = await stageUploadPart(token, i, body);
    if (!r.ok) return r;
  }
  return commitUpload(token, parts.length);
}

// 파일 놓는 곳, 이번 결과, 손댄 거래 확인 대화상자(3단계 파일 7.1·7.2), 카카오뱅크 암호 입력(4.3-4)
export function UploadPanel({ isDemo, userDailyLimit }: { isDemo: boolean; userDailyLimit: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [requestError, setRequestError] = useState<string>();
  const [classifyInfo, setClassifyInfo] = useState<Pick<ApplyOk, "classifyError" | "classifyLimit"> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  // 암호가 필요한 파일: 암호를 받으면 다시 읽는다.
  const [passwordFiles, setPasswordFiles] = useState<File[]>([]);
  const [passwordError, setPasswordError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>();

  const show = (result: UploadResult, names: { name: string; uploaded?: UploadedFile }[], readErrors: Entry[]) => {
    if (!result.ok) {
      setRequestError(result.message);
      setEntries(readErrors);
      return;
    }
    setRequestError(undefined);
    setClassifyInfo({ classifyError: result.classifyError, classifyLimit: result.classifyLimit });
    const sent = result.files.map((r, i) => ({ ...names[i], result: r }));
    setEntries([...sent, ...readErrors]);
    if (result.files.some((r) => r.status === "needs_confirm")) setConfirmOpen(true);
  };

  // 파일을 읽어 업로드한다. 암호가 필요한 카카오뱅크 파일은 저장된 암호로 먼저 읽고, 안 되면 입력을 받는다.
  const readAndUpload = async (files: File[], password?: string) => {
    let stored = password;
    const read: { name: string; uploaded: UploadedFile }[] = [];
    const errors: Entry[] = [];
    const needPassword: File[] = [];
    for (const file of files) {
      setStatus(`${file.name} 읽는 중…`);
      let outcome = await readUploadFile(file, stored);
      if (outcome.status === "needs_password" && stored === undefined) {
        const saved = await loadKakaoPasswordAction();
        stored = saved.ok ? (saved.password ?? undefined) : undefined;
        if (stored) outcome = await readUploadFile(file, stored);
      }
      if (outcome.status === "ok") read.push({ name: file.name, uploaded: outcome.file });
      else if (outcome.status === "needs_password") needPassword.push(file);
      else errors.push({ name: file.name, result: { status: "error", fileName: file.name, message: outcome.message } });
    }
    if (needPassword.length > 0) {
      if (password !== undefined) {
        setPasswordError("암호가 맞지 않습니다. 다시 넣어 주세요.");
        return;
      }
      setPasswordFiles(needPassword);
      setPasswordError(undefined);
    } else if (password !== undefined) {
      // 넣은 암호로 읽었으면 다음부터 묻지 않게 저장한다(암호화해 저장, 4.3-4).
      await saveKakaoPasswordAction(password);
      setPasswordFiles([]);
    }
    if (read.length === 0) {
      setEntries((prev) => (password !== undefined ? [...prev, ...errors] : errors));
      setStatus(undefined);
      return;
    }
    setStatus("올리는 중…");
    const result = await send(read.map((r) => ({ ...r.uploaded, confirmedIds: [] })));
    setStatus(undefined);
    if (password !== undefined) {
      // 암호를 넣고 읽은 파일은 앞서 올린 결과 뒤에 붙인다.
      if (!result.ok) return setRequestError(result.message);
      setClassifyInfo({ classifyError: result.classifyError, classifyLimit: result.classifyLimit });
      setEntries((prev) => [...prev, ...result.files.map((r, i) => ({ ...read[i], result: r })), ...errors]);
      if (result.files.some((r) => r.status === "needs_confirm")) setConfirmOpen(true);
      return;
    }
    show(result, read, errors);
  };

  const uploadNew = (files: File[]) => {
    if (files.length === 0 || pending) return;
    if (isDemo) return setDemoOpen(true);
    startTransition(() => readAndUpload(files));
  };

  const submitPassword = (password: string) => {
    if (password.length === 0 || password.length > KAKAO_PASSWORD_MAX) return setPasswordError(`암호는 1~${KAKAO_PASSWORD_MAX}자로 넣어 주세요.`);
    startTransition(() => readAndUpload(passwordFiles, password));
  };

  // 일부 파일만 다시 보내고 그 자리의 결과를 바꾼다. 같은 계좌 파일 오류는 요청 전체 오류로 보여준다.
  const resend = async (items: Resend[]): Promise<UploadFileResult[] | string> => {
    const files = items.map((it) => ({ ...entries[it.index].uploaded!, confirmedIds: it.confirmedIds ?? [], createAccount: it.createAccount }));
    const result = await send(files);
    if (!result.ok) return result.message;
    if (result.files.some((r) => r.status === "applied")) setClassifyInfo({ classifyError: result.classifyError, classifyLimit: result.classifyLimit });
    setEntries((prev) =>
      prev.map((e, i) => {
        const at = items.findIndex((it) => it.index === i);
        return at < 0 ? e : { ...e, result: result.files[at] };
      }),
    );
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

  const limited = classifyInfo?.classifyLimit.limited;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => (isDemo ? setDemoOpen(true) : inputRef.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label="금융사 파일 고르기"
        className={cn(
          "flex h-32 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-card px-3 text-center text-muted-foreground transition-colors hover:bg-brand-soft/60",
          dragging && "border-primary bg-brand-soft",
          pending && "cursor-wait",
        )}
      >
        {pending ? (
          <span role="status">{status ?? "읽는 중…"}</span>
        ) : (
          <>
            <UploadIcon aria-hidden="true" className="mb-1 size-5 text-primary" />
            <span className="font-medium text-foreground">금융사 파일을 끌어다 놓거나 눌러서 고르세요</span>
            <span>여러 개를 한 번에 올릴 수 있습니다. 파일은 이 브라우저에서 읽고, 원본 파일은 서버로 보내지 않습니다.</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(e) => {
          uploadNew([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {requestError && (
        <p role="alert" className="text-destructive">
          {requestError}
        </p>
      )}

      {entries.length > 0 && (
        <Panel title="이번 결과">
          {/* 좁은 폭(md 아래)에서는 금융사·계정·기간·넣은 수·지운 수를 파일 이름 아래 한 줄로 모아 표가 잘리지 않게 한다(design-refresh 명세서 4.6-1). */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>파일</TableHead>
                  <TableHead className="hidden md:table-cell">금융사</TableHead>
                  <TableHead className="hidden md:table-cell">계정</TableHead>
                  <TableHead className="hidden md:table-cell">기간</TableHead>
                  <TableHead className="hidden text-right md:table-cell">넣은 수</TableHead>
                  <TableHead className="hidden text-right md:table-cell">지운 수</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(({ result: r }, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-56 whitespace-normal break-all md:truncate md:break-normal md:whitespace-nowrap">
                      {r.fileName}
                      <div className="mt-0.5 text-xs break-keep text-muted-foreground md:hidden">
                        {[
                          r.institution && INSTITUTION_LABELS[r.institution],
                          r.status !== "error" && r.account.name,
                          r.period && `${r.period.start} ~ ${r.period.end}`,
                          r.status === "applied" && `넣음 ${formatNumber(r.insertedCount)} · 지움 ${formatNumber(r.deletedCount)}`,
                          r.status === "needs_confirm" && `넣음 ${formatNumber(r.insertCount)} · 지움 ${formatNumber(r.deleteCount)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{r.institution ? INSTITUTION_LABELS[r.institution] : ""}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.status !== "error" && (
                        <Link href={`/transactions?account=${r.account.id}&month=${r.period.end.slice(0, 7)}`} className="hover:underline">
                          {r.account.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">{r.period && `${r.period.start} ~ ${r.period.end}`}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {r.status === "applied" && formatNumber(r.insertedCount)}
                      {r.status === "needs_confirm" && <span className="text-muted-foreground">{formatNumber(r.insertCount)}</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {r.status === "applied" && formatNumber(r.deletedCount)}
                      {r.status === "needs_confirm" && <span className="text-muted-foreground">{formatNumber(r.deleteCount)}</span>}
                    </TableCell>
                    <TableCell className="whitespace-normal md:whitespace-nowrap">
                      {r.status === "applied" && <span className="text-primary">반영함{r.createdAccount && "(계정 만듦)"}</span>}
                      {/* 이번 반영에서 새로 생긴 보정만 보여준다(4단계 파일 6.2). */}
                      {r.status === "applied" && r.newAdjustments.count > 0 && (
                        <div className="text-xs whitespace-normal text-notice-foreground">
                          보정 {formatNumber(r.newAdjustments.count)}건, 합계 <Money value={r.newAdjustments.total} plus />
                        </div>
                      )}
                      {r.status === "applied" && <CategoryLine counts={r.categories} />}
                      {r.status === "needs_confirm" && (
                        <Button variant="link" size="xs" className="h-auto px-0 text-notice-foreground" disabled={pending} onClick={() => setConfirmOpen(true)}>
                          확인 필요
                        </Button>
                      )}
                      {r.status === "error" && (
                        <div className="flex flex-wrap items-center gap-2 whitespace-normal">
                          <span className="text-destructive">{r.message}</span>
                          {r.newAccount && (
                            <Button size="xs" variant="outline" disabled={pending} onClick={() => createAndUpload(i)}>
                              계정 만들고 올리기
                            </Button>
                          )}
                        </div>
                      )}
                      {r.status === "error" && r.newAccount && <div className="text-xs text-muted-foreground">만들 계정: {r.newAccount.name}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {classifyInfo?.classifyError && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-notice-foreground">
              <span>{classifyErrorMessage(classifyInfo.classifyError)}</span>
              {!limited && <ReclassifyButton />}
            </div>
          )}
          {limited && <p className="mt-2 text-notice-foreground">{classifyLimitMessage(userDailyLimit)}</p>}
        </Panel>
      )}

      <ConfirmDialog
        open={confirmOpen && needsConfirm.length > 0}
        onOpenChange={setConfirmOpen}
        wide
        title={`직접 손댄 거래 ${formatNumber(touchedCount)}건이 지워집니다`}
        description="덮어쓰면 파일 내용으로 바뀌고, 고친 내용은 다시 붙지 않습니다. 잘못 올렸으면 업로드 기록에서 이 업로드를 되돌릴 수 있습니다."
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

      <PasswordDialog
        open={passwordFiles.length > 0}
        names={passwordFiles.map((f) => f.name)}
        error={passwordError}
        pending={pending}
        onSubmit={submitPassword}
        onCancel={() => setPasswordFiles([])}
      />

      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>로그인하면 할 수 있습니다.</DialogTitle>
            <DialogDescription>데모에서는 파일을 올릴 수 없습니다. 구글로 로그인하면 내 파일을 올려 정리할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDemoOpen(false)}>
              닫기
            </Button>
            <a href="/api/auth/login" className={buttonVariants()}>
              구글로 로그인
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 카카오뱅크 파일 암호 입력(4.3-4). 맞으면 암호화해 저장해 다음부터 묻지 않는다. 화면에 다시 보여 주지 않는다.
function PasswordDialog({
  open,
  names,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  names: string[];
  error?: string;
  pending: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
        setValue("");
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>카카오뱅크 파일 암호</DialogTitle>
            <DialogDescription>
              {names.join(", ")} 파일은 암호가 걸려 있습니다. 파일을 내려받을 때 정한 암호를 넣어 주세요. 맞으면 암호화해 저장하고 다음부터 묻지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kakao-password">암호</Label>
            <Input id="kakao-password" type="password" autoComplete="off" maxLength={KAKAO_PASSWORD_MAX} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "읽는 중…" : "열기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "분류: 저장된 분류 N · AI N · 미분류 N"(5단계 파일 6장). 미분류가 0이면 빼고, 분류할 거래가 없으면 줄을 뺀다.
function CategoryLine({ counts }: { counts: Extract<UploadFileResult, { status: "applied" }>["categories"] }) {
  if (counts.saved + counts.ai + counts.pending === 0) return null;
  const parts = [`저장된 분류 ${formatNumber(counts.saved)}`, `AI ${formatNumber(counts.ai)}`];
  if (counts.pending > 0) parts.push(`미분류 ${formatNumber(counts.pending)}`);
  return <div className="text-xs whitespace-normal text-muted-foreground">분류: {parts.join(" · ")}</div>;
}
