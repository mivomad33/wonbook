import { describe, expect, it } from "vitest";
import { accountFormSchema, accountInputSchema, toAccountInput } from "@/lib/account-form";
import { toAccountKeyRef } from "@/lib/privacy/account-key";

describe("계정 폼 검사", () => {
  it("부채 기초 잔액은 양수로 받아 음수로 저장하고, 빈 칸은 null로 바꾼다", () => {
    const r = accountFormSchema.parse({
      name: "  전세 대출 ",
      kind: "liability",
      institution: "",
      externalKey: "",
      openingBalance: "50000000",
      openingDate: "2026-10-01",
    });
    expect(r).toEqual({
      name: "전세 대출",
      kind: "liability",
      institution: null,
      externalKey: null,
      openingBalance: -50_000_000,
      openingDate: "2026-10-01",
    });
  });

  it("카드 계정은 기초 잔액·기준일을 버리고, 식별값은 은행·증권일 때만 정규화해 남긴다", () => {
    const card = accountFormSchema.parse({
      name: "하나카드",
      kind: "card",
      institution: "hana_card",
      externalKey: "123",
      openingBalance: "1000",
      openingDate: "2026-10-01",
    });
    expect(card).toMatchObject({ externalKey: null, openingBalance: 0, openingDate: null });

    const bank = accountFormSchema.parse({ name: "급여", kind: "asset", institution: "hana_bank", externalKey: " 123-45 " });
    expect(bank).toMatchObject({ externalKey: "12345", openingBalance: 0, openingDate: null });
  });

  it("이름 없음, 종류에 맞지 않는 금융사, 잘못된 금액·날짜를 막는다", () => {
    const errors = (input: Record<string, string>) => {
      const r = accountFormSchema.safeParse({ name: "계정", kind: "asset", ...input });
      return r.success ? [] : r.error.issues.map((i) => i.path[0]);
    };
    expect(errors({ name: "  " })).toEqual(["name"]);
    expect(errors({ kind: "card", institution: "hana_bank" })).toEqual(["institution"]);
    expect(errors({ kind: "liability", institution: "kb_bank" })).toEqual(["institution"]);
    expect(errors({ openingBalance: "-100" })).toEqual(["openingBalance"]);
    expect(errors({ openingBalance: "1.5" })).toEqual(["openingBalance"]);
    expect(errors({ openingDate: "2026-13-01" })).toEqual(["openingDate"]);
    const r = accountFormSchema.safeParse({ name: "계정", kind: "asset", openingDate: "x" });
    expect(r.error?.issues[0].message).toBe("기준일을 YYYY-MM-DD로 입력하세요.");
  });
});

describe("서버로 보내는 계정 값(4.7-1)", () => {
  it("계좌번호는 해시와 끝 4자리로 바꿔 보내고, 수정 때 빈 칸은 그대로 두기(undefined)로 보낸다", async () => {
    const bank = accountFormSchema.parse({ name: "급여", kind: "asset", institution: "hana_bank", externalKey: "111-222222-33333" });
    const input = await toAccountInput(bank);
    expect(input).toEqual({
      name: "급여",
      kind: "asset",
      institution: "hana_bank",
      accountKey: await toAccountKeyRef("hana_bank", "11122222233333"),
      openingBalance: 0,
      openingDate: null,
    });
    expect(JSON.stringify(input)).not.toContain("11122222233333");

    const blank = accountFormSchema.parse({ name: "급여", kind: "asset", institution: "hana_bank", externalKey: "" });
    expect((await toAccountInput(blank)).accountKey).toBeNull();
    expect((await toAccountInput(blank, { keepBlankKey: true })).accountKey).toBeUndefined();
    const card = accountFormSchema.parse({ name: "카드", kind: "card", institution: "hana_card" });
    expect((await toAccountInput(card, { keepBlankKey: true })).accountKey).toBeNull();
  });

  it("서버는 받은 값을 다시 검사하고, 식별값을 쓰지 않는 금융사의 식별값은 버린다", async () => {
    const accountKey = await toAccountKeyRef("hana_bank", "111");
    const base = { name: "계정", kind: "asset", institution: "hana_bank", accountKey, openingBalance: -5, openingDate: null };
    expect(accountInputSchema.parse(base)).toMatchObject({ accountKey, openingBalance: -5 });
    expect(accountInputSchema.parse({ ...base, kind: "card", institution: "hana_card" })).toMatchObject({ accountKey: null, openingBalance: 0 });
    expect(accountInputSchema.safeParse({ ...base, accountKey: { digest: "11122222233333", last4: "3333" } }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, openingBalance: 1.5 }).success).toBe(false);
    expect(accountInputSchema.safeParse({ ...base, kind: "card" }).success).toBe(false);
  });
});
