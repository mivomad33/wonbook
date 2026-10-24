"use client";

import { type ComponentProps, useState } from "react";
import { CategoryBadge, CategoryDot } from "@/components/category-style";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { CATEGORY_GROUPS, type CategoryGroup } from "@/db/schema";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

// 화면에 넘기는 카테고리 정보. 목록은 카테고리 화면과 같은 순서(묶음 → sort_order)로 넘긴다(5단계 파일 8장).
// color는 카테고리 색 이름이다(design-refresh 명세서 4.5).
export type CategoryOption = { id: number; name: string; group: CategoryGroup; color: string };

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

// 브라우저 기본 선택 상자는 항목마다 색을 칠할 수 없어서, 고른 카테고리의 색 점을 상자 앞에 둔다(design-refresh 명세서 4.5-5).
function SelectedDot({ categories, value }: { categories: CategoryOption[]; value: unknown }) {
  const selected = categories.find((c) => String(c.id) === String(value ?? ""));
  return <CategoryDot color={selected?.color ?? null} className={cn(!selected && "opacity-60")} />;
}

// 폼용 카테고리 선택(수동 거래 폼, 5단계 파일 2장). 비우면 미분류.
export function CategorySelect({
  categories,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "children"> & { categories: CategoryOption[] }) {
  const [value, setValue] = useState(props.value ?? props.defaultValue ?? "");
  return (
    <span className="flex items-center gap-2">
      <SelectedDot categories={categories} value={props.value ?? value} />
      <NativeSelect
        {...props}
        onChange={(e) => {
          setValue(e.target.value);
          props.onChange?.(e);
        }}
      >
        <NativeSelectOption value="">미분류</NativeSelectOption>
        <GroupedOptions categories={categories} />
      </NativeSelect>
    </span>
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
    <span className="flex items-center gap-2">
      {value !== null && <SelectedDot categories={categories} value={value} />}
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
    </span>
  );
}

// 고를 수 있는 카테고리 배지(색 점과 이름, design-refresh 명세서 4.5-5). 미분류는 회색이다. onChange가 있으면 눌러서 바로 고른다(5단계 파일 7.1).
// 목록을 띄우는 데 브라우저 기본 선택 상자를 배지 위에 투명하게 겹쳐 쓴다. 묶음(optgroup)과 키보드 선택이 그대로 된다.
export function CategoryBadgeSelect({
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
  const color = categories.find((c) => c.id === categoryId)?.color ?? null;
  const tag = <CategoryBadge name={categoryId == null ? null : name} color={color} className={cn(onChange && "group-hover:brightness-95")} />;
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
