"use server";

import { actionUser } from "@/auth/current";
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
import { textLimitErrors } from "../input-limits";
import { revalidateApp } from "../revalidate";

// 내용·메모 길이 상한(4.10-4)
const TEXT_FIELDS = ["description", "memo"] as const;

// 입력과 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
export async function saveTransactionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await actionUser();
    const parsed = transactionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodErrorState(parsed.error);
    const tooLong = textLimitErrors(parsed.data, TEXT_FIELDS);
    if (tooLong) return tooLong;
    const rawId = formData.get("id");
    const db = getAppDb();
    if (rawId) await updateTransaction(db, user.id, idSchema.parse(rawId), parsed.data);
    else await createTransaction(db, user.id, parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateApp();
  return { ok: true };
}

export async function saveTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await actionUser();
    const parsed = transferFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodErrorState(parsed.error);
    const tooLong = textLimitErrors(parsed.data, TEXT_FIELDS);
    if (tooLong) return tooLong;
    const rawId = formData.get("id");
    const db = getAppDb();
    if (rawId) await updateTransfer(db, user.id, idSchema.parse(rawId), parsed.data);
    else await createTransfer(db, user.id, parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateApp();
  return { ok: true };
}

// 삭제 표시와 되살리기. 오류 문구를 돌려주면 확인 대화상자가 보여준다.
export async function setTransactionDeletedAction(id: number, deleted: boolean): Promise<string | void> {
  try {
    const user = await actionUser();
    await setTransactionDeleted(getAppDb(), user.id, idSchema.parse(id), deleted === true);
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateApp();
}

// 거래 목록 배지에서 카테고리를 바꾼다(5단계 파일 7.1). 같은 키라 함께 바꾼 거래 수나 오류 문구를 돌려준다.
export async function setTransactionCategoryAction(id: number, categoryId: number): Promise<{ sameKeyCount: number } | { error: string }> {
  let result: { sameKeyCount: number };
  try {
    const user = await actionUser();
    result = await setTransactionCategory(getAppDb(), user.id, idSchema.parse(id), idSchema.parse(categoryId));
  } catch (e) {
    return { error: userErrorState(e).error ?? "카테고리를 바꾸지 못했습니다." };
  }
  revalidateApp();
  return result;
}
