import { getAppDb } from "@/db/client";
import { formatShortDateTime } from "@/lib/format";
import { lastImportAt } from "@/lib/import/upload";

// 사이드바 맨 아래 마지막 업로드 시각(3단계 파일 7.3). 업로드 서버 액션이 레이아웃 전체를 다시 그려 바뀐다.
export async function LastImport({ userId }: { userId: number }) {
  const at = await lastImportAt(getAppDb(), userId);
  return <span>{at ? `마지막 업로드 ${formatShortDateTime(at)}` : "업로드 기록 없음"}</span>;
}
