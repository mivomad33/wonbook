"use server";

import { revalidatePath } from "next/cache";
import { getAppDb } from "@/db/client";
import { setTransactionCategory } from "@/lib/categorize";
import { idSchema } from "@/lib/form-fields";
import { type FormState, userErrorState, zodErrorState } from "@/lib/form-state";
import { transactionFormSchema, transferFormSchema } from "@/lib/transaction-form";
import {
  createTransaction,
  createTransfer,
  setTransactionDeleted,
  updateTransaction,
  updateTransfer,
} from "@/lib/transactions";

// 거래는 잔액(자산 현황)과 거래 수(계정 관리)에도 보이므로 전체를 다시 그린다.
const revalidateAll = () => revalidatePath("/", "layout");

// 입력과 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
export async function saveTransactionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = transactionFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error);
  const rawId = formData.get("id");
  try {
    if (rawId) updateTransaction(getAppDb(), idSchema.parse(rawId), parsed.data);
    else createTransaction(getAppDb(), parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateAll();
  return { ok: true };
}

export async function saveTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = transferFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error);
  const rawId = formData.get("id");
  try {
    if (rawId) updateTransfer(getAppDb(), idSchema.parse(rawId), parsed.data);
    else createTransfer(getAppDb(), parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateAll();
  return { ok: true };
}

// 삭제 표시와 되살리기. 오류 문구를 돌려주면 확인 대화상자가 보여준다.
export async function setTransactionDeletedAction(id: number, deleted: boolean): Promise<string | void> {
  try {
    setTransactionDeleted(getAppDb(), idSchema.parse(id), deleted);
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateAll();
}

// 거래 목록 배지에서 카테고리를 바꾼다(5단계 파일 7.1). 같은 키라 함께 바꾼 거래 수나 오류 문구를 돌려준다.
export async function setTransactionCategoryAction(id: number, categoryId: number): Promise<{ sameKeyCount: number } | { error: string }> {
  let result: { sameKeyCount: number };
  try {
    result = setTransactionCategory(getAppDb(), idSchema.parse(id), idSchema.parse(categoryId));
  } catch (e) {
    return { error: userErrorState(e).error ?? "카테고리를 바꾸지 못했습니다." };
  }
  revalidateAll();
  return result;
}
