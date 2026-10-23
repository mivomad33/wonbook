import { connection } from "next/server";
import { Notice } from "@/components/notice";
import { ReclassifyButton } from "@/components/reclassify-button";
import { getAppDb } from "@/db/client";
import { countPending } from "@/lib/categorize";
import { formatNumber } from "@/lib/format";

// 미분류 업로드 거래가 있으면 "다시 분류" 버튼을 보여준다(5단계 파일 5.3). 업로드 화면과 거래 목록 위쪽이 같이 쓴다.
// DB를 읽으므로 <Suspense>로 감싸 쓴다(design.md 2.3).
export async function PendingNotice() {
  await connection();
  const n = countPending(getAppDb());
  if (n === 0) return null;
  return <Notice title={`미분류 거래 ${formatNumber(n)}건`} action={<ReclassifyButton />} />;
}
