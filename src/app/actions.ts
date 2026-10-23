"use server";

import { revalidatePath } from "next/cache";
import { getAppDb } from "@/db/client";
import { dismissAdjustmentNotice } from "@/lib/balance/notice";
import { classifierFromEnv, classifyPending, type ClassifyResult } from "@/lib/categorize";

// 자산 현황의 보정 알림 "닫기"(4단계 파일 6.3)
export async function dismissAdjustmentNoticeAction() {
  dismissAdjustmentNotice(getAppDb());
  revalidatePath("/");
}

// 미분류 업로드 거래 전체를 다시 분류한다(5단계 파일 5.3). 업로드 화면과 거래 목록(5-3)이 같이 쓴다.
export async function reclassifyAction(): Promise<ClassifyResult> {
  const result = await classifyPending(getAppDb(), { classify: classifierFromEnv() });
  revalidatePath("/", "layout");
  return result;
}
