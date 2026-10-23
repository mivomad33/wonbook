"use client";

import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/form-state";

// 거래 폼과 이체 폼이 같이 쓰는 칸(2단계 파일 3.2: 날짜, 시각, 내용, 메모는 일반 거래와 같다).

type Errors = Record<string, string>;

export function ErrorText({ errors, name }: { errors: Errors; name: string }) {
  return errors[name] ? <FieldError>{errors[name]}</FieldError> : null;
}

export function DateTimeFields({ errors, date, time }: { errors: Errors; date: string; time?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field data-invalid={!!errors.date}>
        <FieldLabel htmlFor="tx-date">날짜</FieldLabel>
        <Input id="tx-date" name="date" type="date" defaultValue={date} aria-invalid={!!errors.date} />
        <ErrorText errors={errors} name="date" />
      </Field>
      <Field data-invalid={!!errors.time}>
        <FieldLabel htmlFor="tx-time">시각(선택)</FieldLabel>
        <Input
          id="tx-time"
          name="time"
          type="time"
          // 업로드 거래는 초까지 있다. 초가 있으면 초도 보여줘 저장할 때 잘리지 않게 한다.
          step={time && time.length > 5 ? 1 : undefined}
          defaultValue={time ?? ""}
          aria-invalid={!!errors.time}
        />
        <ErrorText errors={errors} name="time" />
      </Field>
    </div>
  );
}

export function TextFields({ errors, description, memo }: { errors: Errors; description?: string; memo?: string | null }) {
  return (
    <>
      <Field data-invalid={!!errors.description}>
        <FieldLabel htmlFor="tx-description">내용(선택)</FieldLabel>
        <Input id="tx-description" name="description" defaultValue={description ?? ""} placeholder="상대방·사용처" />
        <ErrorText errors={errors} name="description" />
      </Field>
      <Field data-invalid={!!errors.memo}>
        <FieldLabel htmlFor="tx-memo">메모(선택)</FieldLabel>
        <Input id="tx-memo" name="memo" defaultValue={memo ?? ""} />
        <ErrorText errors={errors} name="memo" />
      </Field>
    </>
  );
}

export function FormFooter({ state, pending }: { state: FormState; pending: boolean }) {
  return (
    <>
      {state.error && <FieldError className="mt-3">{state.error}</FieldError>}
      <DialogFooter className="mt-4">
        <DialogClose render={<Button type="button" variant="outline" />}>취소</DialogClose>
        <Button type="submit" disabled={pending}>
          저장
        </Button>
      </DialogFooter>
    </>
  );
}
