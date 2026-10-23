import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestContext } from "@/db/test-db";
import { accounts, imports, transactions } from "@/db/schema";
import type { Cell } from "@/lib/parsers/types";
import { parseFile } from "@/lib/parsers";
import { hanaBankSheets, hanaCardSheets } from "@/lib/parsers/test-sheets";
import type { Classifier } from "@/lib/categorize";
import { createTransaction } from "@/lib/transactions";
import { toUploadedFile, type UploadRequestFile } from "./payload";
import { lastImportAt, listRecentImports, uploadFiles, type UploadFileResult } from "./upload";

// 가짜 표를 실제 xlsx 바이트로 만들어, 브라우저와 같은 순서(파일 읽기 → 보낼 값 만들기)를 거친다.
function xlsx(rows: Cell[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

async function browserFile(name: string, data: Uint8Array, extra: Partial<UploadRequestFile> = {}): Promise<UploadRequestFile> {
  return { ...(await toUploadedFile(name, await parseFile(data))), confirmedIds: [], ...extra };
}

const hanaBank = (name = "하나.xlsx", extra: Partial<UploadRequestFile> = {}) =>
  browserFile(
    name,
    xlsx(
      hanaBankSheets([
        ["2026-07-20 09:00:00", "하나카드", "하나카드", 50_000, 0, 150_000, ""],
        ["2026-07-10 10:30:15", "대체", "급여", 0, 200_000, 200_000, ""],
      ])[0],
    ),
    extra,
  );

const hanaCard = (extra: Partial<UploadRequestFile> = {}) =>
  browserFile(
    "하나카드.xlsx",
    xlsx(hanaCardSheets([["2026.07.05", "12:00:00", "본인", "1", "가게", 10_000, 0, "일시불", "", "매입", 10_000, 0, 0, "정상"]])[0]),
    extra,
  );

async function setup() {
  const { db, userId } = await createTestContext();
  const upload = (files: UploadRequestFile[], classify: Classifier | null = null) => uploadFiles(db, userId, files, { classify, quota: null });
  return { db, userId, upload };
}

const filesOf = (result: Awaited<ReturnType<typeof uploadFiles>>): UploadFileResult[] => {
  if (!result.ok) throw new Error(result.message);
  return result.files;
};

const accountsOf = (db: Db) => db.select().from(accounts);

describe("uploadFiles", () => {
  it("맞는 계정이 없으면 만들 계정을 알려주고, 계정 만들고 올리기로 기초 잔액을 파일에서 채운다", async () => {
    const { db, upload } = await setup();
    const [first] = filesOf(await upload([await hanaBank()]));
    expect(first).toMatchObject({
      status: "error",
      message: "맞는 계정이 없습니다.",
      newAccount: { name: "하나은행 3333", kind: "asset", accountKeyLast4: "3333" },
    });
    expect(await accountsOf(db)).toHaveLength(0);

    const [second] = filesOf(await upload([await hanaBank("하나.xlsx", { createAccount: true })]));
    expect(second).toMatchObject({ status: "applied", insertedCount: 2, deletedCount: 0, createdAccount: true, period: { start: "2026-07-01", end: "2026-07-31" } });
    const [account] = await accountsOf(db);
    // 가장 오래된 거래 직전 잔액(200,000 − 200,000)과 조회기간 시작 전날
    expect(account).toMatchObject({ name: "하나은행 3333", institution: "hana_bank", openingBalance: 0, openingDate: "2026-06-30", externalKeyLast4: "3333" });
  });

  it("같은 파일을 다시 올려도 거래가 늘지 않고, 업로드 기록과 마지막 업로드 시각이 남는다", async () => {
    const { db, userId, upload } = await setup();
    await upload([await hanaBank("하나.xlsx", { createAccount: true })]);
    const [again] = filesOf(await upload([await hanaBank()]));
    expect(again).toMatchObject({ status: "applied", insertedCount: 2, deletedCount: 2, createdAccount: false });
    expect(await db.select().from(transactions)).toHaveLength(2);
    expect((await listRecentImports(db, userId)).map((r) => [r.accountName, r.undoable])).toEqual([
      ["하나은행 3333", true],
      ["하나은행 3333", false],
    ]);
    expect(await lastImportAt(db, userId)).not.toBeNull();
  });

  it("손댄 거래가 있으면 반영하지 않고 묻고, 확인한 id와 다시 보내면 반영한다", async () => {
    const { db, userId, upload } = await setup();
    await upload([await hanaBank("하나.xlsx", { createAccount: true })]);
    const [{ id: accountId }] = await accountsOf(db);
    const manualId = await createTransaction(db, userId, { accountId, date: "2026-07-15", time: null, amount: -3_000, description: "현금", memo: null });

    const [asked] = filesOf(await upload([await hanaBank()]));
    expect(asked).toMatchObject({ status: "needs_confirm", insertCount: 2, deleteCount: 3, touched: [expect.objectContaining({ id: manualId })] });
    expect(await db.select().from(transactions).where(eq(transactions.id, manualId))).toHaveLength(1);

    const [applied] = filesOf(await upload([await hanaBank("하나.xlsx", { confirmedIds: [manualId] })]));
    expect(applied).toMatchObject({ status: "applied", deletedCount: 3 });
    expect(await db.select().from(transactions).where(eq(transactions.id, manualId))).toHaveLength(0);
  });

  it("같은 계좌 파일이 둘이면 아무것도 반영하지 않는다", async () => {
    const { db, upload } = await setup();
    const result = await upload([
      await hanaBank("a.xlsx", { createAccount: true }),
      await hanaCard(),
      await hanaBank("b.xlsx", { createAccount: true }),
    ]);
    expect(result).toEqual({ ok: false, message: "같은 계좌 파일이 2개 있습니다: a.xlsx, b.xlsx. 하나만 골라 다시 올려 주세요." });
    expect(await accountsOf(db)).toHaveLength(0);
  });

  it("여러 파일을 한 번에 반영하고 파일마다 결과를 돌려준다", async () => {
    const { db, upload } = await setup();
    const files = filesOf(await upload([await hanaBank("하나.xlsx", { createAccount: true }), await hanaCard({ createAccount: true })]));
    expect(files.map((f) => f.status)).toEqual(["applied", "applied"]);
    expect(files[1]).toMatchObject({ account: { name: "하나카드" } });
    expect(await accountsOf(db)).toHaveLength(2);
  });

  it("반영한 뒤 미분류를 분류해 파일마다 분류 결과를 붙이고, 확인으로 멈춘 파일은 분류하지 않는다(5단계 파일 5·6장)", async () => {
    const { db, userId, upload } = await setup();
    const classify = vi.fn<Classifier>(async (items) => new Map(items.map((it) => [it.id, it.description === "가게" ? "장보기" : "기타 수입"])));
    const files = filesOf(await upload([await hanaBank("하나.xlsx", { createAccount: true }), await hanaCard({ createAccount: true })], classify));
    expect(files.map((f) => f.status === "applied" && f.categories)).toEqual([
      { saved: 0, ai: 2, pending: 0 },
      { saved: 0, ai: 1, pending: 0 },
    ]);
    expect(classify).toHaveBeenCalledTimes(1);

    // 다시 올리면 저장된 분류로 붙는다. 손댄 거래가 있는 은행 파일은 멈추고, API는 부르지 않는다.
    const [{ id: accountId }] = await db.select().from(accounts).where(eq(accounts.kind, "asset"));
    await createTransaction(db, userId, { accountId, date: "2026-07-15", time: null, amount: -3_000, description: "현금", memo: null });
    classify.mockClear();
    const result = await upload([await hanaBank(), await hanaCard()], classify);
    expect(result).toMatchObject({ ok: true, classifyError: null, classifyLimit: { limited: false, limitedKeys: 0 } });
    expect(filesOf(result).map((f) => (f.status === "applied" ? f.categories : f.status))).toEqual(["needs_confirm", { saved: 1, ai: 0, pending: 0 }]);
    expect(classify).not.toHaveBeenCalled();
  });

  it("API 키가 없거나 호출이 실패하면 반영은 하고 미분류로 남긴 이유를 돌려준다", async () => {
    const { upload } = await setup();
    const noKey = await upload([await hanaCard({ createAccount: true })]);
    expect(noKey).toMatchObject({ ok: true, classifyError: { kind: "no_key" }, files: [{ status: "applied", categories: { saved: 0, ai: 0, pending: 1 } }] });

    const classify = vi.fn<Classifier>(async () => {
      throw new Error("overloaded");
    });
    const failed = await upload([await hanaCard()], classify);
    expect(failed).toMatchObject({ ok: true, classifyError: { kind: "failed", message: "overloaded" }, files: [{ status: "applied" }] });
  });
});

describe("서버로 보내는 값(4.3-1)", () => {
  it("브라우저 값에는 계좌번호·원본 행이 없고, 거래 내용·파일 이름의 긴 숫자는 가려진다", async () => {
    const data = xlsx(
      hanaBankSheets([
        ["2026-07-20 09:00:00", "대체", "청약 111-222222-44444", 50_000, 0, 150_000, ""],
        ["2026-07-10 10:30:15", "대체", "급여", 0, 200_000, 200_000, ""],
      ])[0],
    );
    const parsed = await parseFile(data);
    const sent = await toUploadedFile("하나_111-222222-33333.xlsx", parsed);
    // 해시(16진수)에는 숫자가 우연히 길게 이어질 수 있어 빼고 본다.
    const json = JSON.stringify({ ...sent, accountKey: null });
    expect(json).not.toMatch(/\d{10,}/);
    expect(json).not.toContain("222222");
    expect(json).not.toContain('"raw"');
    expect(sent).toMatchObject({ fileName: "하나_****3333.xlsx", accountKey: { last4: "3333" } });
    expect(sent.transactions[1]).toMatchObject({ description: "청약 ****4444" });
  });

  it("서버는 받은 값에 남은 긴 숫자를 다시 가려 저장한다", async () => {
    const { db, upload } = await setup();
    const file = await hanaBank("하나.xlsx", { createAccount: true });
    // 가리지 않고 보낸 요청(브라우저 코드를 거치지 않은 요청)
    file.fileName = "하나_111-222222-33333.xlsx";
    file.transactions[0] = { ...file.transactions[0], description: "이체 12345678901234", memo: "메모 98765432109" };
    filesOf(await upload([file]));
    const [record] = await db.select().from(imports);
    expect(record.fileName).toBe("하나_****3333.xlsx");
    const stored = await db.select().from(transactions);
    expect(stored.map((r) => r.description)).toContain("이체 ****1234");
    expect(stored.map((r) => r.memo)).toContain("메모 ****2109");
    expect(JSON.stringify(stored)).not.toMatch(/\d{10,}/);
  });
});
