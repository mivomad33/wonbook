"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { APP_DB_PATH, getAppDb } from "@/db/client";
import { classifierFromEnv } from "@/lib/categorize";
import { backupDirFor, createBackup } from "@/lib/import/backup";
import { uploadFiles, type UploadResult } from "@/lib/import/upload";

// 파일마다 같은 순서로 붙는 정보: 확인한 손댄 거래 id, 계정 만들고 올리기 여부(3단계 파일 5.2)
const metaSchema = z.array(
  z.object({ confirmedIds: z.array(z.number().int().positive()), createAccount: z.boolean() }),
);

// 화면이 고른 파일을 들고 있다가 확인 뒤 다시 보낸다. 서버는 아무것도 저장하지 않고 매번 처음부터 읽는다(결정 D8).
export async function uploadFilesAction(formData: FormData): Promise<UploadResult> {
  const files = formData.getAll("file").filter((f): f is File => f instanceof File);
  const meta = metaSchema.parse(JSON.parse(String(formData.get("meta") ?? "[]")));
  if (meta.length !== files.length) throw new Error("파일과 정보의 개수가 다릅니다.");

  const db = getAppDb();
  const inputs = await Promise.all(
    files.map(async (file, i) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()), ...meta[i] })),
  );
  const result = await uploadFiles(db, inputs, {
    // 카카오뱅크 파일 암호. 비밀 값이라 DB가 아니라 .env.local에 둔다(design.md 1.2 settings).
    password: process.env.KAKAOBANK_FILE_PASSWORD,
    createBackup: () => createBackup(db, backupDirFor(APP_DB_PATH)),
    classify: classifierFromEnv(),
  });
  // 거래·계정·사이드바 마지막 업로드 시각이 모든 화면에 보이므로 전체를 다시 그린다(3단계 파일 7.3).
  revalidatePath("/", "layout");
  return result;
}
