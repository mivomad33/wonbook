import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { accounts, transactions } from "@/db/schema";
import type { Cell } from "@/lib/parsers/types";
import { hanaBankSheets, hanaCardSheets } from "@/lib/parsers/test-sheets";
import type { Classifier } from "@/lib/categorize";
import { createTransaction } from "@/lib/transactions";
import { lastImportAt, listRecentImports, uploadFiles, type UploadFileInput, type UploadFileResult } from "./upload";

// 가짜 표를 실제 xlsx 바이트로 만들어 파일 읽기부터 거친다.
function xlsx(rows: Cell[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}

const hanaBank = (name = "하나.xlsx", extra: Partial<UploadFileInput> = {}): UploadFileInput => ({
  name,
  data: xlsx(
    hanaBankSheets([
      ["2026-07-20 09:00:00", "하나카드", "하나카드", 50_000, 0, 150_000, ""],
      ["2026-07-10 10:30:15", "대체", "급여", 0, 200_000, 200_000, ""],
    ])[0],
  ),
  confirmedIds: [],
  ...extra,
});

const hanaCard = (): UploadFileInput => ({
  name: "하나카드.xlsx",
  data: xlsx(hanaCardSheets([["2026.07.05", "12:00:00", "본인", "1", "가게", 10_000, 0, "일시불", "", "매입", 10_000, 0, 0, "정상"]])[0]),
  confirmedIds: [],
});

function setup() {
  const db = createTestDb();
  const createBackup = vi.fn(() => "/tmp/backup.db");
  const upload = (files: UploadFileInput[]) => uploadFiles(db, files, { createBackup });
  return { db, createBackup, upload };
}

const filesOf = (result: Awaited<ReturnType<typeof uploadFiles>>): UploadFileResult[] => {
  if (!result.ok) throw new Error(result.message);
  return result.files;
};

describe("uploadFiles", () => {
  it("맞는 계정이 없으면 만들 계정을 알려주고, 계정 만들고 올리기로 기초 잔액을 파일에서 채운다", async () => {
    const { db, createBackup, upload } = setup();
    const [first] = filesOf(await upload([hanaBank()]));
    expect(first).toMatchObject({
      status: "error",
      message: "맞는 계정이 없습니다.",
      newAccount: { name: "하나은행 3333", kind: "asset", externalKey: "11122222233333" },
    });
    expect(createBackup).not.toHaveBeenCalled();
    expect(db.select().from(accounts).all()).toHaveLength(0);

    const [second] = filesOf(await upload([hanaBank("하나.xlsx", { createAccount: true })]));
    expect(second).toMatchObject({ status: "applied", insertedCount: 2, deletedCount: 0, createdAccount: true, period: { start: "2026-07-01", end: "2026-07-31" } });
    const account = db.select().from(accounts).get()!;
    // 가장 오래된 거래 직전 잔액(200,000 − 200,000)과 조회기간 시작 전날
    expect(account).toMatchObject({ name: "하나은행 3333", institution: "hana_bank", openingBalance: 0, openingDate: "2026-06-30" });
    expect(createBackup).toHaveBeenCalledTimes(1);
  });

  it("같은 파일을 다시 올려도 거래가 늘지 않고, 업로드마다 백업한다", async () => {
    const { db, createBackup, upload } = setup();
    await upload([hanaBank("하나.xlsx", { createAccount: true })]);
    const [again] = filesOf(await upload([hanaBank()]));
    expect(again).toMatchObject({ status: "applied", insertedCount: 2, deletedCount: 2, createdAccount: false });
    expect(db.select().from(transactions).all()).toHaveLength(2);
    expect(createBackup).toHaveBeenCalledTimes(2);
    expect(listRecentImports(db).map((r) => r.accountName)).toEqual(["하나은행 3333", "하나은행 3333"]);
    expect(lastImportAt(db)).not.toBeNull();
  });

  it("손댄 거래가 있으면 반영하지 않고 묻고, 확인한 id와 다시 보내면 반영한다", async () => {
    const { db, createBackup, upload } = setup();
    await upload([hanaBank("하나.xlsx", { createAccount: true })]);
    const accountId = db.select().from(accounts).get()!.id;
    const manualId = createTransaction(db, { accountId, date: "2026-07-15", time: null, amount: -3_000, description: "현금", memo: null });
    createBackup.mockClear();

    const [asked] = filesOf(await upload([hanaBank()]));
    expect(asked).toMatchObject({ status: "needs_confirm", insertCount: 2, deleteCount: 3, touched: [expect.objectContaining({ id: manualId })] });
    expect(createBackup).not.toHaveBeenCalled();
    expect(db.select().from(transactions).where(eq(transactions.id, manualId)).get()).toBeDefined();

    const [applied] = filesOf(await upload([hanaBank("하나.xlsx", { confirmedIds: [manualId] })]));
    expect(applied).toMatchObject({ status: "applied", deletedCount: 3 });
    expect(db.select().from(transactions).where(eq(transactions.id, manualId)).get()).toBeUndefined();
    expect(createBackup).toHaveBeenCalledTimes(1);
  });

  it("같은 계좌 파일이 둘이면 아무것도 반영하지 않는다", async () => {
    const { db, createBackup, upload } = setup();
    const result = await upload([hanaBank("a.xlsx", { createAccount: true }), hanaCard(), hanaBank("b.xlsx", { createAccount: true })]);
    expect(result).toEqual({ ok: false, message: "같은 계좌 파일이 2개 있습니다: a.xlsx, b.xlsx. 하나만 골라 다시 올려 주세요." });
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("읽을 수 없는 파일이 있어도 다른 파일은 반영하고, 백업은 요청당 한 번이다", async () => {
    const { db, createBackup, upload } = setup();
    const broken: UploadFileInput = { name: "메모.txt", data: new TextEncoder().encode("hello"), confirmedIds: [] };
    const files = filesOf(await upload([broken, hanaBank("하나.xlsx", { createAccount: true }), { ...hanaCard(), createAccount: true }]));
    expect(files.map((f) => f.status)).toEqual(["error", "applied", "applied"]);
    expect(files[0]).toMatchObject({ fileName: "메모.txt" });
    expect(files[2]).toMatchObject({ account: { name: "하나카드" } });
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(createBackup).toHaveBeenCalledTimes(1);
  });

  it("반영한 뒤 미분류를 분류해 파일마다 분류 결과를 붙이고, 확인으로 멈춘 파일은 분류하지 않는다(5단계 파일 5·6장)", async () => {
    const { db } = setup();
    const createBackup = () => "/tmp/backup.db";
    const classify = vi.fn<Classifier>(async (items) => new Map(items.map((it) => [it.id, it.description === "가게" ? "장보기" : "기타 수입"])));
    const files = filesOf(
      await uploadFiles(db, [hanaBank("하나.xlsx", { createAccount: true }), { ...hanaCard(), createAccount: true }], { createBackup, classify }),
    );
    expect(files.map((f) => f.status === "applied" && f.categories)).toEqual([
      { saved: 0, ai: 2, pending: 0 },
      { saved: 0, ai: 1, pending: 0 },
    ]);
    expect(classify).toHaveBeenCalledTimes(1);

    // 다시 올리면 저장된 분류로 붙는다. 손댄 거래가 있는 은행 파일은 멈추고, API는 부르지 않는다.
    const accountId = db.select().from(accounts).where(eq(accounts.kind, "asset")).get()!.id;
    createTransaction(db, { accountId, date: "2026-07-15", time: null, amount: -3_000, description: "현금", memo: null });
    classify.mockClear();
    const result = await uploadFiles(db, [hanaBank(), hanaCard()], { createBackup, classify });
    expect(result).toMatchObject({ ok: true, classifyError: null });
    expect(filesOf(result).map((f) => f.status === "applied" ? f.categories : f.status)).toEqual(["needs_confirm", { saved: 1, ai: 0, pending: 0 }]);
    expect(classify).not.toHaveBeenCalled();
  });

  it("API 키가 없거나 호출이 실패하면 반영은 하고 미분류로 남긴 이유를 돌려준다", async () => {
    const { db } = setup();
    const createBackup = () => "/tmp/backup.db";
    const noKey = await uploadFiles(db, [{ ...hanaCard(), createAccount: true }], { createBackup });
    expect(noKey).toMatchObject({ ok: true, classifyError: { kind: "no_key" }, files: [{ status: "applied", categories: { saved: 0, ai: 0, pending: 1 } }] });

    const classify = vi.fn<Classifier>(async () => {
      throw new Error("overloaded");
    });
    const failed = await uploadFiles(db, [hanaCard()], { createBackup, classify });
    expect(failed).toMatchObject({ ok: true, classifyError: { kind: "failed", message: "overloaded" }, files: [{ status: "applied" }] });
  });
});
