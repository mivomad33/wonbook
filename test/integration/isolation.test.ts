// 사용자끼리 데이터가 섞이지 않는다(4.2-2, 4.2-4, 4.3-4, 4.2-5). B가 A의 id로 보낸 요청은 거부되고 A의 데이터는 그대로다.
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dismissAdjustmentNoticeAction } from "@/app/(app)/actions";
import { deleteAccountAction, moveAccountAction, saveAccountAction } from "@/app/(app)/accounts/actions";
import { deleteCategoryAction, saveCategoryAction } from "@/app/(app)/categories/actions";
import { saveTransactionAction, saveTransferAction, setTransactionCategoryAction, setTransactionDeletedAction } from "@/app/(app)/transactions/actions";
import { commitUpload, loadKakaoPasswordAction, saveKakaoPasswordAction, stageUploadPart, undoImportAction } from "@/app/(app)/upload/actions";
import { GET as exportCsv } from "@/app/api/export/route";
import { categoryRules, settings, transactions, users } from "@/db/schema";
import { listAccounts } from "@/lib/accounts";
import { listTransactions } from "@/lib/transactions";
import { db, dbFingerprint, loginAs, newUser, rejected } from "./helpers";
import { bankFile, categoryId, seedUser } from "./fixtures";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

let a: number;
let b: number;
let A: Awaited<ReturnType<typeof seedUser>>;
let B: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  a = await newUser("a");
  b = await newUser("b");
  A = await seedUser(a);
  B = await seedUser(b);
});

describe("B가 A의 id로 보낸 요청(4.2-2)", () => {
  // 거부 이유까지 본다: 형식 오류처럼 다른 이유로 막혀도 통과하지 않게, 소유 검사의 "찾을 수 없음" 문구를 기대한다.
  const ACCOUNT = "계정을 찾을 수 없습니다";
  const TX = "거래를 찾을 수 없습니다";
  const CATEGORY = "카테고리를 찾을 수 없습니다";
  type Seed = Awaited<ReturnType<typeof seedUser>>;
  // X: 대상 데이터의 주인, Y: 요청하는 사람의 데이터
  const attempts = (X: Seed, Y: Seed): [string, () => Promise<unknown>, string][] => [
    ["계정 수정", () => saveAccountAction(X.accountId, { name: "바꿈", kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null }), ACCOUNT],
    ["계정 삭제", () => deleteAccountAction(X.accountId), ACCOUNT],
    ["계정 순서", () => moveAccountAction(X.accountId, "down"), ACCOUNT],
    ["A 계정에 거래 넣기", () => saveTransactionAction({}, form({ accountId: String(X.accountId), date: "2026-07-06", direction: "out", amount: "1000" })), ACCOUNT],
    ["A 거래 수정", () => saveTransactionAction({}, form({ id: String(X.txId), accountId: String(Y.accountId), date: "2026-07-06", direction: "out", amount: "1000" })), TX],
    ["A 계정에서 이체", () => saveTransferAction({}, form({ fromAccountId: String(X.accountId), toAccountId: String(Y.accountId), date: "2026-07-06", amount: "1000" })), ACCOUNT],
    ["A 거래 삭제 표시", () => setTransactionDeletedAction(X.txId, true), TX],
    ["A 거래 카테고리", () => setTransactionCategoryAction(X.txId, Y.foodId), TX],
    ["B 거래에 A 카테고리", () => setTransactionCategoryAction(Y.txId, X.foodId), CATEGORY],
    ["A 카테고리 수정", () => saveCategoryAction({}, form({ id: String(X.foodId), name: "바꿈", group: "expense" })), CATEGORY],
    ["A 카테고리 삭제", () => deleteCategoryAction(X.foodId), CATEGORY],
    ["A 업로드 되돌리기", () => undoImportAction(X.importId), "업로드 기록을 찾을 수 없습니다"],
    ["B 계정에 A 카테고리로 거래 넣기", () => saveTransactionAction({}, form({ accountId: String(Y.accountId), date: "2026-07-06", direction: "out", amount: "1000", categoryId: String(X.foodId) })), CATEGORY],
  ];

  const names = () => attempts({} as Seed, {} as Seed).map(([name, , reason], i) => [name, i, reason] as const);

  it.each(names())("%s: 소유 검사로 거부되고 DB가 그대로다", async (_name, i, reason) => {
    const call = attempts(A, B)[i][1];
    await loginAs(b);
    const before = await dbFingerprint();
    expect(await rejected(call, reason)).toBe(true);
    expect(await dbFingerprint()).toEqual(before);
  });

  // 같은 요청을 주인이 하면 그 문구로 막히지 않는다. 기대한 문구가 소유 검사에서만 나온다는 것을 확인한다.
  // 요청이 데이터를 바꾸므로 경우마다 새 사용자와 데이터를 쓴다.
  it.each(names())("%s: 주인이 같은 요청을 하면 소유 검사를 지난다", async (_name, i, reason) => {
    const owner = await newUser("owner");
    const O = await seedUser(owner);
    await loginAs(owner);
    expect(await rejected(attempts(O, O)[i][1], reason)).toBe(false);
  });
});

describe("화면·집계·내보내기는 자기 데이터만(4.2-2, 4.2-5)", () => {
  it("B의 계정·거래 목록에 A의 것이 없다", async () => {
    const accountIds = (await listAccounts(db(), b)).map((x) => x.id);
    expect(accountIds).not.toContain(A.accountId);
    expect(accountIds).not.toContain(A.uploadAccountId);
    const txIds = (await listTransactions(db(), b, { accountId: null, group: null, month: "all", categoryId: null, showDeleted: true })).map((t) => t.id);
    expect(txIds).not.toContain(A.txId);
    expect(txIds).toContain(B.txId);
  });

  it("CSV는 그 사용자의 거래 수만큼이고 앞에 BOM이 있다", async () => {
    await loginAs(b);
    const res = await exportCsv();
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(buf).trim().split("\n");
    const mine = await db().select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, b));
    expect(lines.length - 1).toBe(mine.length);
  });

  it("업로드는 B의 계정만 찾는다: A와 같은 계좌 파일을 B가 올리면 맞는 계정이 없다", async () => {
    const token = "b".repeat(32);
    // seedUser가 쓴 계좌는 A·B 모두 계정이 있으므로, 다른 번호로 A에게만 계정을 만든다.
    await loginAs(a);
    await stageUploadPart(token, 0, JSON.stringify([await bankFile({ key: "99988877766655" })]));
    const ra = await commitUpload(token, 1);
    expect(ra.ok && ra.files[0].status).toBe("applied");
    await loginAs(b);
    await stageUploadPart(token, 0, JSON.stringify([await bankFile({ key: "99988877766655", createAccount: false })]));
    const rb = await commitUpload(token, 1);
    expect(rb.ok && rb.files[0].status).toBe("error");
    expect(rb.ok && rb.files[0].status === "error" && rb.files[0].message).toBe("맞는 계정이 없습니다.");
  });

  it("B가 A의 업로드 조각을 가져갈 수 없다", async () => {
    await loginAs(a);
    const token = "c".repeat(32);
    await stageUploadPart(token, 0, JSON.stringify([await bankFile({ key: "55544433322211" })]));
    await loginAs(b);
    expect(await rejected(() => commitUpload(token, 1))).toBe(true);
  });
});

describe("사용자별 설정·분류·암호", () => {
  it("A가 보정 알림을 닫아도 B의 설정은 그대로다(4.2-4)", async () => {
    await loginAs(a);
    expect(await dismissAdjustmentNoticeAction()).toBeUndefined();
    const rows = await db().select().from(settings).where(eq(settings.userId, b));
    expect(rows).toEqual([]);
    expect((await db().select().from(settings).where(eq(settings.userId, a))).length).toBe(1);
  });

  it("같은 가맹점을 두 사용자가 다른 카테고리로 바꿔도 서로 영향이 없다", async () => {
    const txOf = async (userId: number) => {
      const [t] = await db()
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.description, "가짜가게")));
      return t.id;
    };
    await loginAs(a);
    expect(await setTransactionCategoryAction(await txOf(a), await categoryId(a, "장보기"))).not.toHaveProperty("error");
    await loginAs(b);
    expect(await setTransactionCategoryAction(await txOf(b), await categoryId(b, "카페·간식"))).not.toHaveProperty("error");
    const ruleOf = async (userId: number) =>
      (await db().select({ c: categoryRules.categoryId }).from(categoryRules).where(eq(categoryRules.userId, userId))).map((r) => r.c);
    expect(await ruleOf(a)).toContain(await categoryId(a, "장보기"));
    expect(await ruleOf(a)).not.toContain(await categoryId(b, "카페·간식"));
    expect(await ruleOf(b)).toContain(await categoryId(b, "카페·간식"));
    const [ta] = await db().select().from(transactions).where(eq(transactions.id, await txOf(a)));
    expect(ta.categoryId).toBe(await categoryId(a, "장보기"));
  });

  it("카카오뱅크 암호는 그 사용자에게만 돌아가고, DB에는 평문이 없다(4.3-4)", async () => {
    await loginAs(a);
    await saveKakaoPasswordAction("가짜암호-에이");
    await loginAs(b);
    expect(await loadKakaoPasswordAction()).toEqual({ ok: true, password: null });
    const [row] = await db().select({ enc: users.kakaoPasswordEnc }).from(users).where(eq(users.id, a));
    expect(row.enc).toBeTruthy();
    expect(row.enc).not.toContain("가짜암호-에이");
  });
});
