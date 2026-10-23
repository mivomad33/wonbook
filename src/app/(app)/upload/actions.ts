"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/auth/current";
import { getAppDb } from "@/db/client";
import { classifierFromEnv } from "@/lib/categorize";
import { undoImport, type UndoResult } from "@/lib/import";
import { stagePart, takeStaged } from "@/lib/import/staging";
import { uploadFiles, type UploadResult } from "@/lib/import/upload";
import { UserError } from "@/lib/user-error";
import { clearKakaoPassword, KAKAO_PASSWORD_MAX, loadKakaoPassword, saveKakaoPassword } from "@/secrets/kakao-password";
import { revalidateApp } from "../revalidate";

// 업로드 서버 동작(3단계 파일 5장, 4.3). 파일은 브라우저가 읽고, 서버는 읽은 결과만 받는다.
// 업로드 값은 조각으로 나눠 stageUploadPart로 보내고 commitUpload로 한 번에 반영한다(요청 본문 한도, 4.3-2).

type ActionError = { ok: false; message: string };
const fail = (e: unknown): ActionError => {
  if (e instanceof UserError) return { ok: false, message: e.message };
  throw e;
};

export async function stageUploadPart(token: string, part: number, body: string): Promise<{ ok: true } | ActionError> {
  try {
    const user = await actionUser();
    await stagePart(getAppDb(), user.id, token, part, body);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function commitUpload(token: string, total: number): Promise<UploadResult> {
  try {
    const user = await actionUser();
    const db = getAppDb();
    const files = await takeStaged(db, user.id, token, total);
    const result = await uploadFiles(db, user.id, files, { classify: classifierFromEnv(), quota: { userId: user.id, isAdmin: user.isAdmin } });
    revalidateApp();
    return result;
  } catch (e) {
    return fail(e);
  }
}

// 업로드 되돌리기(4.3-5). 그 업로드 뒤 손댄 거래가 있으면 목록을 돌려주고, 확인받은 id를 다시 받아 되돌린다.
export async function undoImportAction(importId: number, confirmedIds: number[] = []): Promise<UndoResult | ActionError> {
  try {
    const user = await actionUser();
    const result = await undoImport(getAppDb(), user.id, importId, { confirmedIds });
    if (result.status === "undone") revalidateApp();
    return result;
  } catch (e) {
    return fail(e);
  }
}

// 카카오뱅크 파일 암호(4.3-4). 저장한 암호는 그 사용자의 업로드 화면에만 넘긴다. 화면에 다시 보여 주지는 않는다.
export async function loadKakaoPasswordAction(): Promise<{ ok: true; password: string | null } | ActionError> {
  try {
    const user = await actionUser();
    return { ok: true, password: await loadKakaoPassword(getAppDb(), user.id) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveKakaoPasswordAction(password: string): Promise<{ ok: true } | ActionError> {
  try {
    const user = await actionUser();
    if (typeof password !== "string" || password.length === 0 || password.length > KAKAO_PASSWORD_MAX) {
      return { ok: false, message: `암호는 1~${KAKAO_PASSWORD_MAX}자로 넣어 주세요.` };
    }
    await saveKakaoPassword(getAppDb(), user.id, password);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function clearKakaoPasswordAction(): Promise<{ ok: true } | ActionError> {
  try {
    const user = await actionUser();
    await clearKakaoPassword(getAppDb(), user.id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
