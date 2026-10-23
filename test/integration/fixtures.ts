// 통합 테스트용 가짜 데이터. 실제 거래·계좌번호를 쓰지 않는다.
import { getAppDb } from "@/db/client";
import { categories } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createAccount } from "@/lib/accounts";
import type { UploadRequestFile } from "@/lib/import/payload";
import { uploadFiles } from "@/lib/import/upload";
import { toAccountKeyRef } from "@/lib/privacy/account-key";
import { createTransaction } from "@/lib/transactions";

export async function categoryId(userId: number, name: string): Promise<number> {
  const [c] = await getAppDb()
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)));
  return c.id;
}

/** 가짜 하나은행 업로드 값(브라우저가 보내는 모양). */
export async function bankFile(opts: { key?: string; descriptions?: string[]; createAccount?: boolean } = {}): Promise<UploadRequestFile> {
  const descriptions = opts.descriptions ?? ["가짜가게", "가짜급여"];
  return {
    fileName: "가짜.xlsx",
    institution: "hana_bank",
    accountKey: await toAccountKeyRef("hana_bank", opts.key ?? "11122233344455"),
    period: { start: "2026-07-01", end: "2026-07-31" },
    transactions: descriptions.map((d, i) => ({
      date: `2026-07-${String(10 + i).padStart(2, "0")}`,
      time: "09:00:00",
      amount: i % 2 === 0 ? -10_000 : 20_000,
      description: d,
      method: null,
      memo: null,
      cardLabel: null,
      balanceAfter: null,
    })),
    confirmedIds: [],
    createAccount: opts.createAccount ?? true,
  };
}

/** 한 사용자의 가계부 데이터 한 벌: 계정, 수동 거래, 업로드(되돌릴 수 있음), 사용자 카테고리. */
export async function seedUser(userId: number) {
  const db = getAppDb();
  const accountId = await createAccount(db, userId, {
    name: "가짜 통장",
    kind: "asset",
    institution: null,
    accountKey: null,
    openingBalance: 100_000,
    openingDate: "2026-07-01",
  });
  const txId = await createTransaction(db, userId, {
    accountId,
    date: "2026-07-05",
    time: null,
    amount: -5_000,
    description: "가짜 수동 거래",
    memo: null,
    categoryId: null,
  });
  const upload = await uploadFiles(db, userId, [await bankFile()], { classify: null, quota: null });
  if (!upload.ok || upload.files[0].status !== "applied") throw new Error("업로드 준비 실패");
  const importId = upload.files[0].importId;
  const uploadAccountId = upload.files[0].account.id;
  const foodId = await categoryId(userId, "장보기");
  return { accountId, txId, importId, uploadAccountId, foodId };
}
