"use client";

import { useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useFormAction } from "@/hooks/use-form-action";
import { CATEGORY_GROUPS } from "@/db/schema";
import type { CategoryListItem } from "@/lib/categories";
import { CATEGORY_GROUP_LABELS } from "@/lib/labels";
import { saveCategoryAction } from "./actions";
import { ReclassifyOthersBody } from "./reclassify-others";

// 카테고리 추가·수정 폼(5단계 파일 8장). category가 있으면 수정이다.
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStep("form");
          setFormKey((k) => k + 1);
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        {step === "others" ? (
          <ReclassifyOthersBody count={othersCount} title="카테고리를 추가했습니다" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{category ? "카테고리 수정" : "카테고리 추가"}</DialogTitle>
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

  return (
    <form onSubmit={onSubmit}>
      {category && <input type="hidden" name="id" value={category.id} />}
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="category-name">이름</FieldLabel>
          <Input id="category-name" name="name" defaultValue={category?.name} aria-invalid={!!errors.name} autoFocus />
          {fieldError("name")}
        </Field>
        <Field data-invalid={!!errors.group}>
          <FieldLabel htmlFor="category-group">묶음</FieldLabel>
          <NativeSelect id="category-group" name="group" className="w-full" defaultValue={category?.group ?? "expense"}>
            {CATEGORY_GROUPS.map((g) => (
              <NativeSelectOption key={g} value={g}>
                {CATEGORY_GROUP_LABELS[g]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {fieldError("group")}
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
