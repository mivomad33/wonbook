"use server";

import { actionUser } from "@/auth/current";
import { getAppDb } from "@/db/client";
import { createCategory, deleteCategory, updateCategory } from "@/lib/categories";
import { categoryFormSchema } from "@/lib/category-form";
import { classifierFromEnv, classifyLimits, reclassifyOthers, type ReclassifyOthersResult } from "@/lib/categorize";
import { formatNumber } from "@/lib/format";
import { idSchema } from "@/lib/form-fields";
import { type FormState, userErrorState, zodErrorState } from "@/lib/form-state";
import { textLimitErrors } from "../input-limits";
import { revalidateApp } from "../revalidate";

// 추가와 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await actionUser();
    const parsed = categoryFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return zodErrorState(parsed.error);
    const tooLong = textLimitErrors(parsed.data, ["name"]);
    if (tooLong) return tooLong;
    const rawId = formData.get("id");
    const db = getAppDb();
    if (rawId) await updateCategory(db, user.id, idSchema.parse(rawId), parsed.data);
    else await createCategory(db, user.id, parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateApp();
  return { ok: true };
}

export async function deleteCategoryAction(id: number): Promise<string | void> {
  try {
    const user = await actionUser();
    await deleteCategory(getAppDb(), user.id, idSchema.parse(id));
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateApp();
}

// limitMessage: 한도 때문에 묻지 못한 가맹점이 있으면 안내 문구(4.4-2). 숫자는 서버 설정값이다.
// 다시 묻지 못한 가맹점은 미분류가 아니라 "기타"로 남으므로 classifyLimitMessage 대신 따로 쓴다.
export type ReclassifyOthersActionResult = (ReclassifyOthersResult & { ok: true; limitMessage: string | null }) | { ok: false; message: string };

// "기타"로 분류한 가맹점만 지금 목록으로 다시 묻는다(5단계 파일 8장, 결정 F9).
export async function reclassifyOthersAction(): Promise<ReclassifyOthersActionResult> {
  let result: ReclassifyOthersResult;
  try {
    const user = await actionUser();
    result = await reclassifyOthers(getAppDb(), user.id, {
      classify: classifierFromEnv(),
      quota: { userId: user.id, isAdmin: user.isAdmin },
    });
  } catch (e) {
    return { ok: false, message: userErrorState(e).error ?? "다시 분류하지 못했습니다." };
  }
  revalidateApp();
  const limitMessage = result.limited
    ? `하루 분류 한도(${formatNumber(classifyLimits().userDaily)}건) 때문에 가맹점 ${formatNumber(result.limitedKeys)}곳은 다시 묻지 못하고 그대로 남았습니다. 내일 다시 분류할 수 있습니다.`
    : null;
  return { ...result, ok: true, limitMessage };
}
