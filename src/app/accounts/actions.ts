"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAppDb } from "@/db/client";
import { accountFormSchema } from "@/lib/account-form";
import { createAccount, deleteAccount, moveAccount, updateAccount } from "@/lib/accounts";
import { type FormState, userErrorState, zodErrorState } from "@/lib/form-state";

const idSchema = z.coerce.number().int().positive();

// 계정은 모든 화면(자산 현황, 거래 목록의 계정 선택 등)에 보이므로 전체를 다시 그린다.
const revalidateAll = () => revalidatePath("/", "layout");

// 만들기와 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
export async function saveAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = accountFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error);
  const rawId = formData.get("id");
  try {
    if (rawId) updateAccount(getAppDb(), idSchema.parse(rawId), parsed.data);
    else createAccount(getAppDb(), parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateAll();
  return { ok: true };
}

export async function deleteAccountAction(id: number) {
  deleteAccount(getAppDb(), idSchema.parse(id));
  revalidateAll();
}

export async function moveAccountAction(id: number, direction: "up" | "down") {
  moveAccount(getAppDb(), idSchema.parse(id), z.enum(["up", "down"]).parse(direction));
  revalidateAll();
}
