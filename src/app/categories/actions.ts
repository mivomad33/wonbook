"use server";

import { revalidatePath } from "next/cache";
import { getAppDb } from "@/db/client";
import { createCategory, deleteCategory, updateCategory } from "@/lib/categories";
import { categoryFormSchema } from "@/lib/category-form";
import { classifierFromEnv, reclassifyOthers, type ReclassifyOthersResult } from "@/lib/categorize";
import { idSchema } from "@/lib/form-fields";
import { type FormState, userErrorState, zodErrorState } from "@/lib/form-state";

// 카테고리는 거래 목록의 배지·거르기와 폼에도 보이므로 전체를 다시 그린다.
const revalidateAll = () => revalidatePath("/", "layout");

// 추가와 수정이 같은 폼을 쓴다. id가 있으면 수정이다.
export async function saveCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = categoryFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error);
  const rawId = formData.get("id");
  try {
    if (rawId) updateCategory(getAppDb(), idSchema.parse(rawId), parsed.data);
    else createCategory(getAppDb(), parsed.data);
  } catch (e) {
    return userErrorState(e);
  }
  revalidateAll();
  return { ok: true };
}

export async function deleteCategoryAction(id: number): Promise<string | void> {
  try {
    deleteCategory(getAppDb(), idSchema.parse(id));
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateAll();
}

// "기타"로 분류한 가맹점만 지금 목록으로 다시 묻는다(5단계 파일 8장, 결정 F9).
export async function reclassifyOthersAction(): Promise<ReclassifyOthersResult> {
  const result = await reclassifyOthers(getAppDb(), { classify: classifierFromEnv() });
  revalidateAll();
  return result;
}
