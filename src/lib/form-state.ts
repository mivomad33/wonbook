// 서버 액션이 폼에 돌려주는 결과(2단계 파일 4장). 화면은 useActionState로 받는다.
import type { z } from "zod";
import { UserError } from "@/lib/user-error";

export type FormState = {
  ok?: boolean;
  // 특정 칸에 붙이지 않는 오류
  error?: string;
  // 칸 이름 → 그 칸의 첫 오류
  fieldErrors?: Record<string, string>;
};

export function zodErrorState(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { fieldErrors };
}

// UserError는 화면에 보여주고, 그 밖의 오류는 그대로 던진다.
export function userErrorState(e: unknown): FormState {
  if (!(e instanceof UserError)) throw e;
  return e.field ? { fieldErrors: { [e.field]: e.message } } : { error: e.message };
}
