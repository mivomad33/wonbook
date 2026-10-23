// 입력 상한(4.10-4)과 업로드 검사(4.3-2)를 서버 동작으로 확인한다. 10,000건 업로드는 요청 크기도 잰다.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { saveAccountAction } from "@/app/(app)/accounts/actions";
import { saveCategoryAction } from "@/app/(app)/categories/actions";
import { saveTransactionAction } from "@/app/(app)/transactions/actions";
import { commitUpload, saveKakaoPasswordAction, stageUploadPart } from "@/app/(app)/upload/actions";
import { accounts, transactions } from "@/db/schema";
import { MAX_PARTS, splitIntoParts, utf8Bytes } from "@/lib/import/split";
import type { UploadRequestFile } from "@/lib/import/payload";
import { createRequire } from "node:module";
import { db, dbFingerprint, loginAs, newUser, rejected } from "./helpers";

// 브라우저가 서버 동작을 부를 때 쓰는 인코딩(React encodeReply, Next.js에 들어 있는 것)으로 요청 본문을 만든다.
const { encodeReply } = createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node.js") as {
  encodeReply: (args: unknown[]) => Promise<string | FormData>;
};
import { bankFile, seedUser } from "./fixtures";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

let me: number;
let ids: Awaited<ReturnType<typeof seedUser>>;
beforeAll(async () => {
  me = await newUser("limits");
  ids = await seedUser(me);
});

// 업로드 화면과 같은 방식(나눠 보내고 한 번에 반영)으로 보낸다. 서버 동작 요청 본문 크기를 함께 돌려준다.
async function send(files: unknown) {
  const token = crypto.randomUUID().replaceAll("-", "");
  const parts = splitIntoParts(JSON.stringify(files));
  const sizes: number[] = [];
  for (const [i, body] of parts.entries()) {
    const encoded = await encodeReply([token, i, body]);
    if (typeof encoded !== "string") throw new Error("서버 동작 본문이 문자열이 아닙니다");
    sizes.push(utf8Bytes(encoded));
    const r = await stageUploadPart(token, i, body);
    if (!r.ok) return { result: r, sizes };
  }
  return { result: await commitUpload(token, parts.length), sizes };
}

const tx = (over: Partial<UploadRequestFile["transactions"][number]> = {}) => ({
  date: "2026-08-01",
  time: null,
  amount: -1_000,
  description: "가짜",
  method: null,
  memo: null,
  cardLabel: null,
  balanceAfter: null,
  ...over,
});

async function fileWith(transactionsList: unknown[], over: Record<string, unknown> = {}) {
  const f = await bankFile({ key: "12312312312312" });
  return [{ ...f, period: { start: "2026-08-01", end: "2026-08-31" }, transactions: transactionsList, ...over }];
}

describe("화면 입력란 상한(4.10-4)", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["계정 이름 101자", () => saveAccountAction(null, { name: "가".repeat(101), kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null })],
    ["카테고리 이름 101자", () => saveCategoryAction({}, form({ name: "가".repeat(101), group: "expense" }))],
    ["거래 내용 101자", () => saveTransactionAction({}, form({ accountId: String(ids.accountId), date: "2026-07-06", direction: "out", amount: "1000", description: "가".repeat(101) }))],
    ["거래 메모 101자", () => saveTransactionAction({}, form({ accountId: String(ids.accountId), date: "2026-07-06", direction: "out", amount: "1000", memo: "가".repeat(101) }))],
    ["카카오뱅크 암호 65자", () => saveKakaoPasswordAction("a".repeat(65))],
  ])("%s는 거부되고 DB가 그대로다", async (_name, call) => {
    await loginAs(me);
    const before = await dbFingerprint();
    expect(await rejected(call)).toBe(true);
    expect(await dbFingerprint()).toEqual(before);
  });

  it("100자는 통과한다", async () => {
    await loginAs(me);
    expect(await rejected(() => saveCategoryAction({}, form({ name: "가".repeat(100), group: "expense" })))).toBe(false);
  });
});

describe("NUL 글자(Postgres가 저장할 수 없는 글자)", () => {
  it("계정 이름의 NUL은 지우고 저장한다(서버 오류가 나지 않는다)", async () => {
    await loginAs(me);
    const r = await saveAccountAction(null, { name: "널\u0000확인 통장", kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null });
    expect(r).toEqual({ ok: true });
    const rows = await db().select({ name: accounts.name }).from(accounts).where(eq(accounts.userId, me));
    expect(rows.map((x) => x.name)).toContain("널확인 통장");
  });

  it("업로드 거래 내용의 NUL은 지우고 반영한다", async () => {
    await loginAs(me);
    const { result } = await send(await fileWith([tx({ date: "2026-08-02", description: "널\u0000가게" })], { period: { start: "2026-08-01", end: "2026-08-31" } }));
    expect(result.ok && result.files[0].status).toBe("applied");
    const rows = await db().select({ d: transactions.description }).from(transactions).where(eq(transactions.userId, me));
    expect(rows.map((x) => x.d)).toContain("널가게");
  });
});

describe("업로드 검사(4.3-2)", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["날짜 형식", () => fileWith([tx({ date: "2026/08/01" })])],
    ["정수가 아닌 금액", () => fileWith([tx({ amount: 1.5 })])],
    ["0원", () => fileWith([tx({ amount: 0 })])],
    ["문자열 금액", () => fileWith([tx({ amount: "1000" as unknown as number })])],
    ["201자 칸", () => fileWith([tx({ description: "가".repeat(201) })])],
    ["201자 메모", () => fileWith([tx({ memo: "가".repeat(201) })])],
    ["10,001건", () => fileWith(Array.from({ length: 10_001 }, () => tx()))],
    ["모르는 금융사", async () => fileWith([tx()], { institution: "other_bank" })],
    ["남의 계정 id 칸", async () => fileWith([tx()], { accountId: ids.uploadAccountId + 100_000 })],
  ])("%s: 거부되고 DB가 그대로다", async (_name, make) => {
    await loginAs(me);
    const before = await dbFingerprint();
    const { result } = await send(await make());
    expect(result.ok).toBe(false);
    const after = await dbFingerprint();
    // 반영하지 않으므로 가계부 데이터는 같다(나눠 보낸 조각도 반영 때 지운다).
    expect(after).toEqual(before);
  });

  it("10,000건(칸마다 한글 200자)이 반영되고, 서버 동작 요청 하나하나가 4.5MB보다 작다", async () => {
    await loginAs(me);
    const long = "가".repeat(200);
    const list = Array.from({ length: 10_000 }, (_, i) =>
      tx({ date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, amount: -(i + 1), description: long, method: long, memo: long, cardLabel: long }),
    );
    const files = await fileWith(list, { period: { start: "2026-09-01", end: "2026-09-30" } });
    const { result, sizes } = await send(files);
    expect(result.ok && result.files[0].status).toBe("applied");
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.length).toBeLessThanOrEqual(MAX_PARTS);
    for (const s of sizes) expect(s).toBeLessThan(4.5 * 1024 * 1024);
    const accountId = result.ok && result.files[0].status === "applied" ? result.files[0].account.id : 0;
    expect((await db().select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, accountId))).length).toBeGreaterThanOrEqual(10_000);
  });
});
