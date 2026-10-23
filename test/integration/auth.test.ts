// 로그인하지 않은 요청과 데모의 쓰기 요청이 모든 서버 동작에서 거부된다(4.1-2, 4.5-3). 관리자만 관리자 화면을 쓴다(4.1-4).
import { beforeAll, describe, expect, it } from "vitest";
import { actionAdmin, DEMO_READONLY_MESSAGE, requireAdmin, requireUser } from "@/auth/current";
import { ensureDemoUser } from "@/auth/demo";
import { dismissAdjustmentNoticeAction, reclassifyAction } from "@/app/(app)/actions";
import { deleteAccountAction as deleteAccountRowAction, moveAccountAction, saveAccountAction } from "@/app/(app)/accounts/actions";
import { deleteCategoryAction, reclassifyOthersAction, saveCategoryAction } from "@/app/(app)/categories/actions";
import { deleteAccountAction } from "@/app/(app)/settings/actions";
import {
  saveTransactionAction,
  saveTransferAction,
  setTransactionCategoryAction,
  setTransactionDeletedAction,
} from "@/app/(app)/transactions/actions";
import {
  clearKakaoPasswordAction,
  commitUpload,
  loadKakaoPasswordAction,
  saveKakaoPasswordAction,
  stageUploadPart,
  undoImportAction,
} from "@/app/(app)/upload/actions";
import { GET as exportCsv } from "@/app/api/export/route";
import { todayUsage } from "@/lib/categorize/quota";
import { RedirectError } from "./setup";
import { asDemo, asGuest, db, dbFingerprint, fakeClassifier, loginAs, newAdmin, newUser, rejected } from "./helpers";
import { bankFile, seedUser } from "./fixtures";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

let ids: Awaited<ReturnType<typeof seedUser>>;

// 서버 동작마다 실제로 무언가를 바꾸는 인자로 부른다(통과하면 DB가 바뀐다).
const actions = (): [string, () => Promise<unknown>][] => [
  ["dismissAdjustmentNoticeAction", () => dismissAdjustmentNoticeAction()],
  ["reclassifyAction", () => reclassifyAction()],
  ["saveAccountAction", () => saveAccountAction(null, { name: "새 계정", kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null })],
  ["deleteAccountAction(계정)", () => deleteAccountRowAction(ids.accountId)],
  ["moveAccountAction", () => moveAccountAction(ids.accountId, "down")],
  ["saveCategoryAction", () => saveCategoryAction({}, form({ name: "새 카테고리", group: "expense" }))],
  ["deleteCategoryAction", () => deleteCategoryAction(ids.foodId)],
  ["reclassifyOthersAction", () => reclassifyOthersAction()],
  [
    "saveTransactionAction",
    () => saveTransactionAction({}, form({ accountId: String(ids.accountId), date: "2026-07-06", direction: "out", amount: "1000", description: "새 거래" })),
  ],
  [
    "saveTransferAction",
    () => saveTransferAction({}, form({ fromAccountId: String(ids.accountId), toAccountId: String(ids.uploadAccountId), date: "2026-07-06", amount: "1000" })),
  ],
  ["setTransactionDeletedAction", () => setTransactionDeletedAction(ids.txId, true)],
  ["setTransactionCategoryAction", () => setTransactionCategoryAction(ids.txId, ids.foodId)],
  ["stageUploadPart", () => stageUploadPart("t".repeat(32), 0, "[]")],
  ["commitUpload", () => commitUpload("t".repeat(32), 1)],
  ["undoImportAction", () => undoImportAction(ids.importId)],
  ["loadKakaoPasswordAction", () => loadKakaoPasswordAction()],
  ["saveKakaoPasswordAction", () => saveKakaoPasswordAction("가짜암호")],
  ["clearKakaoPasswordAction", () => clearKakaoPasswordAction()],
  ["deleteAccountAction(탈퇴)", () => deleteAccountAction()],
];

beforeAll(async () => {
  const owner = await newUser("owner");
  ids = await seedUser(owner);
  await ensureDemoUser(db()); // 데모 데이터는 처음 열 때 만들어지므로 지문을 뜨기 전에 만든다
});

describe("로그인하지 않은 요청(4.1-2)", () => {
  it.each(actions())("%s는 거부되고 DB가 그대로다", async (_name, call) => {
    asGuest();
    const before = await dbFingerprint();
    expect(await rejected(call, "로그인이 필요합니다.")).toBe(true);
    expect(await dbFingerprint()).toEqual(before);
  });

  it("앱 화면은 소개 화면으로, CSV 내보내기는 401", async () => {
    asGuest();
    await expect(requireUser()).rejects.toMatchObject({ to: "/" });
    expect((await exportCsv()).status).toBe(401);
  });
});

describe("데모의 쓰기 요청(4.5-3)", () => {
  it.each(actions())("%s는 거부되고 DB가 그대로다", async (_name, call) => {
    asDemo();
    const before = await dbFingerprint();
    const calls = fakeClassifier().calls;
    expect(await rejected(call, DEMO_READONLY_MESSAGE)).toBe(true);
    expect(await dbFingerprint()).toEqual(before);
    expect(fakeClassifier().calls).toBe(calls);
  });

  it("데모는 CSV를 내려받을 수 없다", async () => {
    asDemo();
    expect((await exportCsv()).status).toBe(403);
  });
});

describe("관리자(4.1-4)", () => {
  it("일반 사용자는 관리자 화면과 관리자 서버 동작이 거부된다", async () => {
    await loginAs(await newUser());
    await expect(requireAdmin()).rejects.toBeInstanceOf(RedirectError);
    await expect(requireAdmin()).rejects.toMatchObject({ to: "/home" });
    await expect(actionAdmin()).rejects.toThrow("관리자만 할 수 있습니다.");
  });

  it("데모도 관리자 화면에 들어갈 수 없다", async () => {
    asDemo();
    await expect(requireAdmin()).rejects.toMatchObject({ to: "/home" });
  });

  it("관리자는 들어가고, 관리자 화면 자료에는 사용자 id와 횟수만 있다(4.6-5)", async () => {
    await loginAs(await newAdmin());
    expect((await requireAdmin()).isAdmin).toBe(true);
    expect((await actionAdmin()).isAdmin).toBe(true);
    const usage = await todayUsage(db());
    for (const row of usage.perUser) expect(Object.keys(row).sort()).toEqual(["count", "userId"]);
    const text = JSON.stringify(usage);
    for (const s of ["가짜 통장", "가짜 수동 거래", "가짜가게", "@test.local"]) expect(text).not.toContain(s);
  });
});

describe("로그인한 사용자", () => {
  it("자기 데이터에는 서버 동작이 통과한다(거부 검사가 늘 거부만 하는 것이 아님을 확인)", async () => {
    const me = await newUser();
    await loginAs(me);
    expect(await rejected(() => saveKakaoPasswordAction("가짜암호"))).toBe(false);
    expect(await loadKakaoPasswordAction()).toEqual({ ok: true, password: "가짜암호" });
    const token = "a".repeat(32);
    expect(await stageUploadPart(token, 0, JSON.stringify([await bankFile()]))).toEqual({ ok: true });
    const r = await commitUpload(token, 1);
    expect(r.ok && r.files[0].status).toBe("applied");
  });
});
