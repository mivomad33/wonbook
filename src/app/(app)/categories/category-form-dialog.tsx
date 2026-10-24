"use client";

import { useState, type ReactElement } from "react";
import { useDemoGuard } from "@/components/demo-guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFormAction } from "@/hooks/use-form-action";
import { CategoryIconBox } from "@/components/category-style";
import { CATEGORY_GROUPS } from "@/db/schema";
import type { CategoryListItem } from "@/lib/categories";
import { isFixedCategory } from "@/lib/category-form";
import { type CategoryColor, type CategoryIcon, DEFAULT_CATEGORY_ICON, isCategoryColor, isCategoryIcon } from "@/lib/category-style";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { TEXT_MAX } from "../input-limits";
import { saveCategoryAction } from "./actions";
import { ColorPicker, IconPicker } from "./category-style-picker";
import { ReclassifyOthersBody } from "./reclassify-others";

// 카테고리 추가·고치기 폼(5단계 파일 8장, design-refresh 명세서 4.5-6). category가 있으면 고치기다. 이름·묶음·색·아이콘을 바꾼다.
// 추가한 뒤 "기타"로 분류한 가맹점(othersCount)이 있으면 같은 대화상자에서 다시 물을지 묻는다(결정 F9).
export function CategoryFormDialog({
  trigger,
  category,
  othersCount = 0,
}: {
  trigger: ReactElement;
  category?: CategoryListItem;
  othersCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "others">("form");
  // 대화상자를 열 때마다 폼을 새로 만들어 이전 입력과 오류를 지운다.
  const [formKey, setFormKey] = useState(0);
  const onSaved = () => {
    if (!category && othersCount > 0) setStep("others");
    else setOpen(false);
  };
  const { guard } = useDemoGuard();
  const openForm = guard(() => {
    setOpen(true);
    setStep("form");
    setFormKey((k) => k + 1);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openForm() : setOpen(false))}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        {step === "others" ? (
          <ReclassifyOthersBody count={othersCount} title="카테고리를 추가했습니다" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{category ? "카테고리 고치기" : "카테고리 추가"}</DialogTitle>
            </DialogHeader>
            <CategoryForm key={formKey} category={category} onSaved={onSaved} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({ category, onSaved }: { category?: CategoryListItem; onSaved: () => void }) {
  const { state, errors, onSubmit, pending } = useFormAction(saveCategoryAction, onSaved);
  const fieldError = (name: string) => errors[name] && <FieldError>{errors[name]}</FieldError>;
  // 새 카테고리는 색을 고르지 않으면 서버가 묶음에서 덜 쓴 색을 고른다(4.5-4).
  const [color, setColor] = useState<CategoryColor | null>(isCategoryColor(category?.color) ? category.color : null);
  const [icon, setIcon] = useState<CategoryIcon>(isCategoryIcon(category?.icon) ? category.icon : DEFAULT_CATEGORY_ICON);
  const [name, setName] = useState(category?.name ?? "");
  // "기타" 카테고리는 AI 분류에 이름으로 쓰므로 이름·묶음은 그대로 두고 색·아이콘만 바꾼다.
  const fixed = category ? isFixedCategory(category.name) : false;

  return (
    <form onSubmit={onSubmit}>
      {category && <input type="hidden" name="id" value={category.id} />}
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="category-name">이름</FieldLabel>
          <div className="flex items-center gap-2.5">
            <CategoryIconBox color={color} icon={icon} size={32} />
            <Input
              id="category-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={TEXT_MAX}
              aria-invalid={!!errors.name}
              readOnly={fixed}
              autoFocus={!fixed}
            />
          </div>
          {fixed && <p className="text-xs text-muted-foreground">AI 분류에 이름으로 써서 이름과 묶음은 바꿀 수 없습니다.</p>}
          {fieldError("name")}
        </Field>
        <Field data-invalid={!!errors.group}>
          <FieldLabel htmlFor="category-group">묶음</FieldLabel>
          {fixed && <input type="hidden" name="group" value={category?.group} />}
          <NativeSelect
            id="category-group"
            name={fixed ? undefined : "group"}
            className="w-full"
            defaultValue={category?.group ?? "expense"}
            disabled={fixed}
          >
            {CATEGORY_GROUPS.map((g) => (
              <NativeSelectOption key={g} value={g}>
                {CATEGORY_GROUP_LABELS[g]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldError("group")}
        </Field>
        <Field data-invalid={!!errors.color}>
          <FieldTitle>색</FieldTitle>
          <ColorPicker value={color} onChange={setColor} />
          {!category && color === null && <p className="text-xs text-muted-foreground">고르지 않으면 묶음에서 덜 쓴 색을 고릅니다.</p>}
          {fieldError("color")}
        </Field>
        <Field data-invalid={!!errors.icon}>
          <FieldTitle>아이콘</FieldTitle>
          <IconPicker value={icon} color={color} onChange={setIcon} />
          {fieldError("icon")}
        </Field>
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
