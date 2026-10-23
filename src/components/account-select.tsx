"use client";

import type { ComponentProps } from "react";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { ACCOUNT_KINDS, type AccountKind } from "@/db/schema";
import type { AccountGroup } from "@/lib/transaction-filter";
import { ACCOUNT_KIND_LABELS } from "@/lib/labels";

// 화면에 넘기는 계정 정보. 목록은 계정 관리와 같은 순서(종류 묶음 → sort_order)로 넘긴다(2단계 파일 1.1).
export type AccountOption = { id: number; name: string; kind: AccountKind };

function GroupedOptions({ accounts, kinds = ACCOUNT_KINDS }: { accounts: AccountOption[]; kinds?: readonly AccountKind[] }) {
  return kinds.map((kind) => {
    const list = accounts.filter((a) => a.kind === kind);
    if (list.length === 0) return null;
    return (
      <NativeSelectOptGroup key={kind} label={ACCOUNT_KIND_LABELS[kind]}>
        {list.map((a) => (
          <NativeSelectOption key={a.id} value={a.id}>
            {a.name}
          </NativeSelectOption>
        ))}
      </NativeSelectOptGroup>
    );
  });
}

// 폼용 계정 선택(2단계 파일 4장). kinds로 고를 수 있는 종류를 줄인다(이체는 자산·부채만).
export function AccountSelect({
  accounts,
  kinds,
  placeholder = "계정을 고르세요",
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "children"> & {
  accounts: AccountOption[];
  kinds?: readonly AccountKind[];
  placeholder?: string;
}) {
  return (
    <NativeSelect {...props}>
      <NativeSelectOption value="">{placeholder}</NativeSelectOption>
      <GroupedOptions accounts={accounts} kinds={kinds} />
    </NativeSelect>
  );
}

export type AccountFilterValue = { accountId: number | null; group: AccountGroup | null };

// 거르기용 계정 선택(2단계 파일 2.1). 전체, 묶음(계정 전체·카드 전체), 계정 하나 중 하나를 고른다.
export function AccountFilterSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: AccountFilterValue;
  onChange: (value: AccountFilterValue) => void;
}) {
  const current = value.accountId != null ? String(value.accountId) : value.group ? `group:${value.group}` : "";
  return (
    <NativeSelect
      aria-label="계정"
      className="w-48"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") onChange({ accountId: null, group: null });
        else if (v.startsWith("group:")) onChange({ accountId: null, group: v.slice(6) as AccountGroup });
        else onChange({ accountId: Number(v), group: null });
      }}
    >
      <NativeSelectOption value="">전체</NativeSelectOption>
      <NativeSelectOption value="group:account">계정 전체(자산·부채)</NativeSelectOption>
      <NativeSelectOption value="group:card">카드 전체</NativeSelectOption>
      <GroupedOptions accounts={accounts} />
    </NativeSelect>
  );
}
