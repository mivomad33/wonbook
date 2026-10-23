"use client";

import type { ComponentProps } from "react";
import { Tag } from "@/components/tag";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { CATEGORY_GROUPS, type CategoryGroup } from "@/db/schema";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

// 화면에 넘기는 카테고리 정보. 목록은 카테고리 화면과 같은 순서(묶음 → sort_order)로 넘긴다(5단계 파일 8장).
export type CategoryOption = { id: number; name: string; group: CategoryGroup };

function GroupedOptions({ categories }: { categories: CategoryOption[] }) {
  return CATEGORY_GROUPS.map((group) => {
    const list = categories.filter((c) => c.group === group);
    if (list.length === 0) return null;
    return (
      <NativeSelectOptGroup key={group} label={CATEGORY_GROUP_LABELS[group]}>
        {list.map((c) => (
          <NativeSelectOption key={c.id} value={c.id}>
            {c.name}
          </NativeSelectOption>
        ))}
      </NativeSelectOptGroup>
    );
  });
}

// 폼용 카테고리 선택(수동 거래 폼, 5단계 파일 2장). 비우면 미분류.
export function CategorySelect({ categories, ...props }: Omit<ComponentProps<typeof NativeSelect>, "children"> & { categories: CategoryOption[] }) {
  return (
    <NativeSelect {...props}>
      <NativeSelectOption value="">미분류</NativeSelectOption>
      <GroupedOptions categories={categories} />
    </NativeSelect>
  );
}

// 거르기 값: 카테고리 id, 미분류("none"), 전체(null). URL의 category=와 같다(design.md 2.1).
export type CategoryFilterValue = number | "none" | null;

// 거르기용 카테고리 선택(5단계 파일 7.1). 전체, 미분류, 묶음별 카테고리 중 하나를 고른다.
export function CategoryFilterSelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}) {
  return (
    <NativeSelect
      aria-label="카테고리"
      className="w-40"
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : v === "none" ? "none" : Number(v));
      }}
    >
      <NativeSelectOption value="">카테고리 전체</NativeSelectOption>
      <NativeSelectOption value="none">미분류</NativeSelectOption>
      <GroupedOptions categories={categories} />
    </NativeSelect>
  );
}

// 카테고리 배지(design.md 3.2). 미분류는 흐리게 보여준다. onChange가 있으면 눌러서 바로 고른다(5단계 파일 7.1).
// 목록을 띄우는 데 브라우저 기본 선택 상자를 배지 위에 투명하게 겹쳐 쓴다. 묶음(optgroup)과 키보드 선택이 그대로 된다.
export function CategoryBadge({
  categories,
  categoryId,
  name,
  disabled,
  onChange,
}: {
  categories: CategoryOption[];
  categoryId: number | null;
  name: string | null;
  disabled?: boolean;
  onChange?: (categoryId: number) => void;
}) {
  const tag = <Tag className={cn(categoryId == null && "opacity-60", onChange && "group-hover:bg-accent group-hover:text-accent-foreground")}>{name ?? "미분류"}</Tag>;
  if (!onChange) return tag;
  return (
    <span className="group relative inline-flex">
      {tag}
      <select
        aria-label="카테고리 바꾸기"
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
        value={categoryId ?? ""}
        disabled={disabled}
        onChange={(e) => e.target.value && onChange(Number(e.target.value))}
      >
        {categoryId == null && <option value="">미분류</option>}
        <GroupedOptions categories={categories} />
      </select>
    </span>
  );
}
