import { describe, expect, it } from "vitest";
import { createTestContext } from "@/db/test-db";
import { imports, transactions } from "@/db/schema";
import { toAccountKeyRef } from "@/lib/privacy/account-key";
import { UserError } from "@/lib/user-error";
import type { UploadedTransaction, UploadRequestFile } from "./payload";
import { uploadFiles } from "./upload";
import { MAX_TEXT_LENGTH, MAX_TRANSACTIONS_PER_REQUEST, parseUploadRequest } from "./validate";

const tx = (extra: Partial<UploadedTransaction> = {}): UploadedTransaction => ({
  date: "2026-10-05",
  time: "09:00:00",
  amount: -1_000,
  description: "가게",
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
  ...extra,
});

const request = async (transactionsInFile: UploadedTransaction[] = [tx()], extra: Partial<UploadRequestFile> = {}): Promise<UploadRequestFile[]> => [
  {
    fileName: "하나.xls",
    institution: "hana_bank",
    accountKey: await toAccountKeyRef("hana_bank", "111-222222-33333"),
    period: { start: "2026-10-01", end: "2026-10-31" },
    transactions: transactionsInFile,
    confirmedIds: [],
    createAccount: true,
    ...extra,
  },
];

const rejects = (input: unknown) => {
  try {
    parseUploadRequest(input);
  } catch (e) {
    expect(e).toBeInstanceOf(UserError);
    return (e as Error).message;
  }
  throw new Error("거부되지 않았습니다.");
};

describe("받은 업로드 값 검사(4.3-2)", () => {
  it("10,000건까지 받고 10,001건은 거부한다", async () => {
    const many = (n: number) => Array.from({ length: n }, () => tx({ description: "한".repeat(MAX_TEXT_LENGTH) }));
    expect(parseUploadRequest(await request(many(MAX_TRANSACTIONS_PER_REQUEST)))[0].transactions).toHaveLength(10_000);
    expect(rejects(await request(many(MAX_TRANSACTIONS_PER_REQUEST + 1)))).toBe(
      "한 번에 올릴 수 있는 거래는 10,000건까지입니다. 파일을 나눠 올려 주세요.",
    );
    // 여러 파일을 더한 수로 센다.
    const [a] = await request(many(6_000));
    expect(rejects([a, { ...a, institution: "kb_bank" }])).toMatch(/10,000건까지/);
  });

  it("문자열 칸은 200자까지 받는다", async () => {
    expect(parseUploadRequest(await request([tx({ memo: "가".repeat(200) })]))).toHaveLength(1);
    expect(rejects(await request([tx({ description: "가".repeat(201) })]))).toBe("내용 칸이 200자를 넘는 거래가 있습니다. 파일을 확인해 주세요.");
    expect(rejects(await request([tx({ memo: "가".repeat(201) })]))).toMatch(/메모 칸이 200자/);
    expect(rejects(await request(undefined, { fileName: "가".repeat(201) }))).toMatch(/파일 이름 칸이 200자/);
  });

  it("날짜·시각 형식, 0원, 소수 금액, 기간 밖 거래, 잘못된 금융사·식별값을 거부한다", async () => {
    expect(rejects(await request([tx({ date: "2026-02-30" })]))).toMatch(/날짜 형식/);
    expect(rejects(await request([tx({ date: "20261005" })]))).toMatch(/날짜 형식/);
    expect(rejects(await request([tx({ time: "25:00" })]))).toMatch(/시각 형식/);
    expect(rejects(await request([tx({ amount: 0 })]))).toMatch(/금액이 0이거나/);
    expect(rejects(await request([tx({ amount: 1.5 })]))).toMatch(/금액이 0이거나/);
    expect(rejects(await request([tx({ date: "2026-11-01" })]))).toMatch(/조회기간 밖/);
    expect(rejects(await request(undefined, { institution: "shinhan_bank" as never }))).toMatch(/금융사 형식/);
    expect(rejects(await request(undefined, { accountKey: { digest: "11122222233333", last4: "3333" } }))).toMatch(/계좌 식별값 형식/);
    expect(rejects(await request(undefined, { period: { start: "2026-10-31", end: "2026-10-01" } }))).toMatch(/조회기간 형식/);
    expect(rejects("not an array")).toMatch(/형식/);
  });

  it("글 칸의 긴 숫자를 다시 가린다(가린 값은 그대로다)", async () => {
    const [file] = parseUploadRequest(
      await request([tx({ description: "이체 111-222222-44444", memo: "****4444", method: "12345 67890" })], { fileName: "KB_123456-01-234567.xls" }),
    );
    expect(file.fileName).toBe("KB_****4567.xls");
    expect(file.transactions[0]).toMatchObject({ description: "이체 ****4444", memo: "****4444", method: "****7890" });
  });

  it("거부된 요청은 아무것도 반영하지 않는다", async () => {
    const { db, userId } = await createTestContext();
    const bad = await request([tx(), tx({ amount: 0 })]);
    await expect(uploadFiles(db, userId, bad, { classify: null, quota: null })).rejects.toThrow(UserError);
    expect(await db.select().from(transactions)).toEqual([]);
    expect(await db.select().from(imports)).toEqual([]);
  });
});
