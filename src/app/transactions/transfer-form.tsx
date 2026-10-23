"use client";

import { AccountSelect, type AccountOption } from "@/components/account-select";
import { MoneyInput } from "@/components/money-input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useFormAction } from "@/hooks/use-form-action";
import type { TransactionListItem } from "@/lib/transactions";
import { saveTransferAction } from "./actions";
import type { EditorDefaults } from "./transaction-editor";
import { DateTimeFields, ErrorText, FormFooter, TextFields } from "./form-fields";

// 카드 계정은 잔액이 없어 이체 대상이 아니다(2단계 파일 3.2).
const TRANSFER_KINDS = ["asset", "liability"] as const;

// 이체 입력·수정 폼(2단계 파일 3.2, 3.3). 반대쪽이 지워진 이체는 남은 쪽만 고치고, 지워진 쪽 계정 칸은 비활성화한다.
export function TransferForm({
  accounts,
  row,
  defaults,
  onSaved,
}: {
  accounts: AccountOption[];
  row?: TransactionListItem;
  defaults: EditorDefaults;
  onSaved: () => void;
}) {
  const { state, errors, onSubmit, pending } = useFormAction(saveTransferAction, onSaved);
  const transferable = (id: number | null | undefined) =>
    id != null && accounts.some((a) => a.id === id && a.kind !== "card") ? String(id) : "";

  // 보내는 쪽이 음수 거래다. 어느 쪽 행에서 열었는지에 따라 반대쪽 계정을 채운다.
  const isOutRow = row ? row.amount < 0 : true;
  const fromId = row ? (isOutRow ? row.accountId : row.peerAccountId) : defaults.accountId;
  const toId = row ? (isOutRow ? row.peerAccountId : row.accountId) : null;
  const peerMissing = row != null && row.transferPeerId == null;
  const fromMissing = peerMissing && !isOutRow;
  const toMissing = peerMissing && isOutRow;

  return (
    <form onSubmit={onSubmit}>
      {row && <input type="hidden" name="id" value={row.id} />}
      <FieldGroup className="gap-4">
        {peerMissing && <FieldDescription>반대쪽 거래가 지워진 이체입니다. 남은 한 건만 고칩니다.</FieldDescription>}
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={!!errors.fromAccountId}>
            <FieldLabel htmlFor="tx-from">보내는 계정</FieldLabel>
            <AccountSelect
              id="tx-from"
              name="fromAccountId"
              className="w-full"
              accounts={accounts}
              kinds={TRANSFER_KINDS}
              defaultValue={fromMissing ? "" : transferable(fromId)}
              disabled={fromMissing}
              placeholder={fromMissing ? "(반대쪽 없음)" : undefined}
              aria-invalid={!!errors.fromAccountId}
            />
            <ErrorText errors={errors} name="fromAccountId" />
          </Field>
          <Field data-invalid={!!errors.toAccountId}>
            <FieldLabel htmlFor="tx-to">받는 계정</FieldLabel>
            <AccountSelect
              id="tx-to"
              name="toAccountId"
              className="w-full"
              accounts={accounts}
              kinds={TRANSFER_KINDS}
              defaultValue={toMissing ? "" : transferable(toId)}
              disabled={toMissing}
              placeholder={toMissing ? "(반대쪽 없음)" : undefined}
              aria-invalid={!!errors.toAccountId}
            />
            <ErrorText errors={errors} name="toAccountId" />
          </Field>
        </div>

        <DateTimeFields errors={errors} date={row?.date ?? defaults.date} time={row?.time} />

        <Field data-invalid={!!errors.amount}>
          <FieldLabel htmlFor="tx-amount">금액</FieldLabel>
          <MoneyInput
            id="tx-amount"
            name="amount"
            defaultValue={row ? Math.abs(row.amount) : undefined}
            aria-invalid={!!errors.amount}
          />
          <ErrorText errors={errors} name="amount" />
        </Field>

        <TextFields errors={errors} description={row?.description} memo={row?.memo} />
      </FieldGroup>
      <FormFooter state={state} pending={pending} />
    </form>
  );
}
