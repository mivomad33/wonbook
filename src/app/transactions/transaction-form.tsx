"use client";

import { useState } from "react";
import { AccountSelect, type AccountOption } from "@/components/account-select";
import { CategorySelect, type CategoryOption } from "@/components/category-select";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useFormAction } from "@/hooks/use-form-action";
import { DIRECTIONS, type Direction } from "@/lib/transaction-form";
import type { TransactionListItem } from "@/lib/transactions";
import { DIRECTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { saveTransactionAction } from "./actions";
import type { EditorDefaults } from "./transaction-editor";
import { DateTimeFields, ErrorText, FormFooter, TextFields } from "./form-fields";

// 일반 거래 입력·수정 폼(2단계 파일 3.1, 3.3). 업로드 거래는 계정을 바꿀 수 없고 방식·card_label은 보여주기만 한다.
export function TransactionForm({
  accounts,
  categories,
  row,
  defaults,
  onSaved,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  row?: TransactionListItem;
  defaults: EditorDefaults;
  onSaved: () => void;
}) {
  const { state, errors, onSubmit, pending } = useFormAction(saveTransactionAction, onSaved);
  const isUpload = row?.source === "upload";
  const [accountId, setAccountId] = useState(String(row?.accountId ?? defaults.accountId ?? ""));
  const [direction, setDirection] = useState<Direction>(row && row.amount > 0 ? "in" : "out");
  const isCard = accounts.find((a) => String(a.id) === accountId)?.kind === "card";
  const directionLabels = DIRECTION_LABELS[isCard ? "card" : "account"];

  return (
    <form onSubmit={onSubmit}>
      {row && <input type="hidden" name="id" value={row.id} />}
      <FieldGroup className="gap-4">
        {isUpload && (
          <FieldDescription>
            업로드한 거래입니다{row.method && ` · 방식: ${row.method}`}
            {row.cardLabel && ` · 카드: ${row.cardLabel}`}. 고치면 다음에 이 기간 파일을 올릴 때 덮어쓸지 확인을 받습니다.
          </FieldDescription>
        )}

        <Field data-invalid={!!errors.accountId}>
          <FieldLabel htmlFor="tx-account">계정</FieldLabel>
          <AccountSelect
            id="tx-account"
            name="accountId"
            className="w-full"
            accounts={accounts}
            value={accountId}
            disabled={isUpload}
            onChange={(e) => setAccountId(e.target.value)}
            aria-invalid={!!errors.accountId}
          />
          {/* 비활성화한 칸은 폼에 실리지 않으므로 값을 따로 넘긴다. */}
          {isUpload && <input type="hidden" name="accountId" value={accountId} />}
          <ErrorText errors={errors} name="accountId" />
        </Field>

        <DateTimeFields errors={errors} date={row?.date ?? defaults.date} time={row?.time} />

        <Field data-invalid={!!errors.amount}>
          <FieldLabel htmlFor="tx-amount">금액</FieldLabel>
          <div className="flex gap-2">
            <div className="flex" role="radiogroup" aria-label="구분">
              {DIRECTIONS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  variant={direction === d ? "default" : "outline"}
                  // 금액 오류로 Field 전체가 빨간 글자가 되어도 토글 글자색은 그대로 둔다.
                  className={cn(d === "in" ? "rounded-r-none" : "-ml-px rounded-l-none", direction !== d && "text-foreground")}
                  onClick={() => setDirection(d)}
                >
                  {directionLabels[d]}
                </Button>
              ))}
            </div>
            <input type="hidden" name="direction" value={direction} />
            <MoneyInput
              id="tx-amount"
              name="amount"
              defaultValue={row ? Math.abs(row.amount) : undefined}
              aria-invalid={!!errors.amount}
              autoFocus={!row}
            />
          </div>
          <ErrorText errors={errors} name="amount" />
        </Field>

        <TextFields errors={errors} description={row?.description} memo={row?.memo} />

        {/* 업로드 거래의 카테고리는 거래 목록의 배지에서 바꾼다. 같은 가맹점 규칙도 함께 바뀌어야 하기 때문이다(5단계 파일 7.1). */}
        {!isUpload && (
          <Field data-invalid={!!errors.categoryId}>
            <FieldLabel htmlFor="tx-category">카테고리(선택)</FieldLabel>
            <CategorySelect
              id="tx-category"
              name="categoryId"
              className="w-full"
              categories={categories}
              defaultValue={row?.categoryId ?? ""}
              aria-invalid={!!errors.categoryId}
            />
            <ErrorText errors={errors} name="categoryId" />
          </Field>
        )}
      </FieldGroup>
      <FormFooter state={state} pending={pending} />
    </form>
  );
}
