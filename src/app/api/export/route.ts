// 거래 CSV 내보내기(4.2-5). 로그인한 그 사용자의 거래만 내려준다. 데모는 내려받을 수 없다(4.5-3).
import { currentUser } from "@/auth/current";
import { getAppDb } from "@/db/client";
import { today } from "@/lib/format";
import { exportTransactionsCsv } from "@/lib/export";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (user.isDemo) return Response.json({ error: "데모에서는 내려받을 수 없습니다. 로그인하면 할 수 있습니다." }, { status: 403 });
  const csv = await exportTransactionsCsv(getAppDb(), user.id);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wonbook-${today()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
