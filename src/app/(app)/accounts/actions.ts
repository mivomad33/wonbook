"use server";

import { z } from "zod";
import { actionUser } from "@/auth/current";
import { getAppDb } from "@/db/client";
import { accountInputSchema } from "@/lib/account-form";
import { createAccount, deleteAccount, moveAccount, updateAccount } from "@/lib/accounts";
import { type FormState, userErrorState, zodErrorState } from "@/lib/form-state";
import { textLimitErrors } from "../input-limits";
import { revalidateApp } from "../revalidate";

const idSchema = z.coerce.number().int().positive();

// 만들기와 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
// input은 브라우저가 toAccountInput으로 만든 값이다(계좌번호 대신 해시와 끝 4자리, 4.7-1). 서버에서 다시 검사한다.
export async function saveAccountAction(id: number | null, input: unknown): Promise<FormState> {
  try {
    const user = await actionUser();
    const parsed = accountInputSchema.safeParse(input);
    if (!parsed.success) return zodErrorState(parsed.error);
    const tooLong = textLimitErrors(parsed.data, ["name"]);
    if (tooLong) return tooLong;
    const db = getAppDb();
    if (id != null) await updateAccount(db, user.id, idSchema.parse(id), parsed.data);
    else await createAccount(db, user.id, parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateApp();
  return { ok: true };
}

// 오류 문구를 돌려주면 확인 대화상자가 보여준다.
export async function deleteAccountAction(id: number): Promise<string | void> {
  try {
    const user = await actionUser();
    await deleteAccount(getAppDb(), user.id, idSchema.parse(id));
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateApp();
}

export async function moveAccountAction(id: number, direction: "up" | "down"): Promise<string | void> {
  try {
    const user = await actionUser();
    await moveAccount(getAppDb(), user.id, idSchema.parse(id), z.enum(["up", "down"]).parse(direction));
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateApp();
}
