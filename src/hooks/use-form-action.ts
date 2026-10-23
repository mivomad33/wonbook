"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { FormState } from "@/lib/form-state";

// 서버 액션 폼 처리(2단계 파일 4장). 계정·거래·이체 폼이 같이 쓴다.
// form action으로 넘기면 React가 제출 뒤 폼을 비워, 오류가 났을 때 입력이 사라진다. 그래서 onSubmit에서 부른다.
export function useFormAction(action: (prev: FormState, formData: FormData) => Promise<FormState>, onSaved: () => void) {
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) onSaved();
    return result;
  }, {});

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  };

  return { state, errors: state.fieldErrors ?? {}, onSubmit, pending };
}
