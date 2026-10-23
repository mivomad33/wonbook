import { describe, expect, it } from "vitest";
import { accountInputSchema } from "./account-form";
import { categoryFormSchema } from "./category-form";
import { transactionFormSchema, transferFormSchema } from "./transaction-form";
import { stripNul } from "./form-fields";

// NUL 글자(U+0000)는 Postgres 글 칸에 저장할 수 없어, 모든 글 칸이 검사 전에 지운다.
const NUL = "\u0000";

describe("NUL 글자 지우기", () => {
  it("문자열의 NUL만 지우고 다른 값은 그대로 둔다", () => {
    expect(stripNul(`가${NUL}나${NUL}`)).toBe("가나");
    expect(stripNul(null)).toBeNull();
    expect(stripNul(3)).toBe(3);
  });

  it("계정·카테고리 이름, 거래·이체 내용과 메모에서 지운다", () => {
    expect(accountInputSchema.parse({ name: `통장${NUL}`, kind: "asset", institution: null, accountKey: null, openingBalance: 0, openingDate: null }).name).toBe("통장");
    expect(categoryFormSchema.parse({ name: `${NUL}식비`, group: "expense" }).name).toBe("식비");
    const tx = transactionFormSchema.parse({ accountId: "1", date: "2026-10-01", direction: "out", amount: "100", description: `가${NUL}게`, memo: `메${NUL}모` });
    expect([tx.description, tx.memo]).toEqual(["가게", "메모"]);
    const tr = transferFormSchema.parse({ fromAccountId: "1", toAccountId: "2", date: "2026-10-01", amount: "100", description: `이${NUL}체`, memo: NUL });
    expect([tr.description, tr.memo]).toEqual(["이체", null]);
  });

  it("NUL만 있는 이름은 빈 이름으로 본다", () => {
    expect(categoryFormSchema.safeParse({ name: NUL, group: "expense" }).success).toBe(false);
  });
});
