"use server";

import { actionUser } from "@/auth/current";
import { getAppDb } from "@/db/client";
import { dismissAdjustmentNotice } from "@/lib/balance/notice";
import { classifierFromEnv, classifyLimitMessage, classifyLimits, classifyPending, type ClassifyResult } from "@/lib/categorize";
import { userErrorState } from "@/lib/form-state";
import { revalidateApp } from "./revalidate";

// 자산 현황의 보정 알림 "닫기"(4단계 파일 6.3). 오류 문구를 돌려주면 화면이 보여준다.
export async function dismissAdjustmentNoticeAction(): Promise<string | void> {
  try {
    const user = await actionUser();
    await dismissAdjustmentNotice(getAppDb(), user.id);
  } catch (e) {
    return userErrorState(e).error;
  }
  revalidateApp();
}

// limitMessage: 한도 때문에 남은 키가 있으면 안내 문구(4.4-2). 숫자는 서버 설정값이라 서버에서 만든다.
export type ReclassifyActionResult = (ClassifyResult & { ok: true; limitMessage: string | null }) | { ok: false; message: string };

// 미분류 업로드 거래 전체를 다시 분류한다(5단계 파일 5.3). 업로드 화면과 거래 목록(5-3)이 같이 쓴다.
export async function reclassifyAction(): Promise<ReclassifyActionResult> {
  let result: ClassifyResult;
  try {
    const user = await actionUser();
    result = await classifyPending(getAppDb(), user.id, {
      classify: classifierFromEnv(),
      quota: { userId: user.id, isAdmin: user.isAdmin },
    });
  } catch (e) {
    return { ok: false, message: userErrorState(e).error ?? "분류하지 못했습니다." };
  }
  revalidateApp();
  return { ...result, ok: true, limitMessage: result.limited ? classifyLimitMessage(classifyLimits().userDaily) : null };
}
