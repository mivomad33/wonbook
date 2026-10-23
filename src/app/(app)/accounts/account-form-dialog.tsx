"use client";

import { useState, type ReactElement } from "react";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useDemoGuard } from "@/components/demo-guard";
import { useFormAction } from "@/hooks/use-form-action";
import { ACCOUNT_KINDS, type AccountKind, type Institution } from "@/db/schema";
import { accountFormSchema, INSTITUTIONS_BY_KIND, KEYED_INSTITUTIONS, toAccountInput } from "@/lib/account-form";
import type { AccountListItem } from "@/lib/accounts";
import { type FormState, zodErrorState } from "@/lib/form-state";
import { toDisplayBalance } from "@/lib/format";
import { ACCOUNT_KIND_LABELS, INSTITUTION_LABELS } from "@/lib/labels";
import { TEXT_MAX } from "../input-limits";
import { saveAccountAction } from "./actions";

// 파일 머리에서 찾는 값과 같은 형태로 넣어야 3단계 업로드가 계정을 찾는다(design.md 1.2 accounts).
const EXTERNAL_KEY_HINTS: Partial<Record<Institution, string>> = {
  hana_bank: "계좌번호 전체",
  kb_bank: "계좌번호 전체",
  kis: "계좌번호 전체",
  kakao_bank: "계좌번호 끝 4자리",
};

// 계정 만들기·수정 폼(2단계 파일 1.2). account가 있으면 수정이다.
export function AccountFormDialog({ trigger, account }: { trigger: ReactElement; account?: AccountListItem }) {
  const [open, setOpen] = useState(false);
  // 대화상자를 열 때마다 폼을 새로 만들어 이전 입력과 오류를 지운다.
  const [formKey, setFormKey] = useState(0);
  const { guard } = useDemoGuard();
  const openForm = guard(() => {
    setOpen(true);
    setFormKey((k) => k + 1);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openForm() : setOpen(false))}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? "계정 수정" : "계정 추가"}</DialogTitle>
        </DialogHeader>
        <AccountForm key={formKey} account={account} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ account, onSaved }: { account?: AccountListItem; onSaved: () => void }) {
  // 계좌번호는 브라우저에서 해시와 끝 4자리로 바꿔 보낸다(4.7-1). 수정 때 식별값 칸을 비워 두면 저장된 값을 그대로 둔다.
  const submit = async (_prev: FormState, formData: FormData): Promise<FormState> => {
    const parsed = accountFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodErrorState(parsed.error);
    const input = await toAccountInput(parsed.data, { keepBlankKey: account != null });
    return saveAccountAction(account?.id ?? null, input);
  };
  const { state, errors: formErrors, onSubmit, pending } = useFormAction(submit, onSaved);
  // 서버 검사의 식별값 오류(accountKey)도 식별값 칸에 보여준다.
  const errors: Record<string, string> = formErrors.accountKey ? { externalKey: formErrors.accountKey, ...formErrors } : formErrors;
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "asset");
  const [institution, setInstitution] = useState<Institution | "">(account?.institution ?? "");

  // 거래가 있으면(삭제 표시 포함) 종류를 바꿀 수 없다.
  const kindLocked = (account?.allTransactionCount ?? 0) > 0;
  const institutionOptions = INSTITUTIONS_BY_KIND[kind];
  const showExternalKey = institution !== "" && KEYED_INSTITUTIONS.includes(institution);
  // 금융사를 바꾸면 저장된 식별값은 맞지 않아 지워진다(lib/accounts).
  const savedKeyLast4 = account && account.institution === institution ? account.externalKeyLast4 : null;
  const fieldError = (name: string) => errors[name] && <FieldError>{errors[name]}</FieldError>;

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="account-name">이름</FieldLabel>
          <Input
            id="account-name"
            name="name"
            defaultValue={account?.name}
            maxLength={TEXT_MAX}
            aria-invalid={!!errors.name}
            autoFocus
          />
          {fieldError("name")}
        </Field>

        <Field data-invalid={!!errors.kind}>
          <FieldLabel htmlFor="account-kind">종류</FieldLabel>
          <NativeSelect
            id="account-kind"
            name="kind"
            className="w-full"
            value={kind}
            disabled={kindLocked}
            onChange={(e) => {
              const next = e.target.value as AccountKind;
              setKind(next);
              if (institution !== "" && !INSTITUTIONS_BY_KIND[next].includes(institution)) setInstitution("");
            }}
          >
            {ACCOUNT_KINDS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {/* 비활성화한 칸은 폼에 실리지 않으므로 값을 따로 넘긴다. */}
          {kindLocked && <input type="hidden" name="kind" value={kind} />}
          {kindLocked && (
            <FieldDescription>거래가 있어 종류를 바꿀 수 없습니다. 바꾸려면 새 계정을 만드세요.</FieldDescription>
          )}
          {fieldError("kind")}
        </Field>

        <Field data-invalid={!!errors.institution}>
          <FieldLabel htmlFor="account-institution">금융사</FieldLabel>
          <NativeSelect
            id="account-institution"
            name="institution"
            className="w-full"
            value={institution}
            onChange={(e) => setInstitution(e.target.value as Institution | "")}
          >
            <NativeSelectOption value="">없음(수동 계정)</NativeSelectOption>
            {institutionOptions.map((i) => (
              <NativeSelectOption key={i} value={i}>
                {INSTITUTION_LABELS[i]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldError("institution")}
        </Field>

        {showExternalKey && (
          <Field data-invalid={!!errors.externalKey}>
            <FieldLabel htmlFor="account-external-key">계좌 식별값</FieldLabel>
            <Input
              id="account-external-key"
              name="externalKey"
              inputMode="numeric"
              maxLength={40}
              // 저장된 값은 끝 4자리만 있어 칸에 채우지 않는다. 비워 두면 그대로 둔다.
              placeholder={savedKeyLast4 ? `··${savedKeyLast4}` : undefined}
              aria-invalid={!!errors.externalKey}
            />
            <FieldDescription>
              {EXTERNAL_KEY_HINTS[institution]}. 업로드한 파일이 어느 계정 것인지 찾을 때 씁니다.
              {savedKeyLast4 && " 비워 두면 지금 값을 그대로 둡니다."} 계좌번호는 끝 4자리만 저장합니다.
            </FieldDescription>
            {fieldError("externalKey")}
          </Field>
        )}
        {/* 식별값 칸이 숨겨져 있어도 금융사 중복 오류는 보여준다. */}
        {!showExternalKey && fieldError("externalKey")}

        {kind !== "card" && (
          <>
            <Field data-invalid={!!errors.openingBalance}>
              <FieldLabel htmlFor="account-opening-balance">
                {kind === "liability" ? "기초 잔액(갚을 금액)" : "기초 잔액"}
              </FieldLabel>
              <MoneyInput
                id="account-opening-balance"
                name="openingBalance"
                // 0은 빈 칸으로 두어 지우지 않고 바로 입력하게 한다. 빈 칸은 0으로 저장된다.
                defaultValue={account ? toDisplayBalance(account.kind, account.openingBalance) || undefined : undefined}
                placeholder="0"
                aria-invalid={!!errors.openingBalance}
              />
              {/* 보정 거래는 업로드 때만 다시 계산한다(4단계 파일 2장). 업로드한 적 있는 계정에만 보여준다. */}
              {account && account.importCount > 0 && (
                <FieldDescription>바꾸면 이미 있는 보정 거래 때문에 잔액이 어긋납니다. 그 기간 파일을 다시 올리면 다시 맞춰집니다.</FieldDescription>
              )}
              {fieldError("openingBalance")}
            </Field>
            <Field data-invalid={!!errors.openingDate}>
              <FieldLabel htmlFor="account-opening-date">기준일</FieldLabel>
              <Input
                id="account-opening-date"
                name="openingDate"
                type="date"
                defaultValue={account?.openingDate ?? ""}
                aria-invalid={!!errors.openingDate}
                className="w-40"
              />
              <FieldDescription>이 날 하루를 마친 뒤의 잔액입니다. 비우면 모든 거래를 더합니다.</FieldDescription>
              {fieldError("openingDate")}
            </Field>
          </>
        )}

        {state.error && <FieldError>{state.error}</FieldError>}
      </FieldGroup>
      <DialogFooter className="mt-4">
        <DialogClose render={<Button type="button" variant="outline" />}>취소</DialogClose>
        <Button type="submit" disabled={pending}>
          저장
        </Button>
      </DialogFooter>
    </form>
  );
}
