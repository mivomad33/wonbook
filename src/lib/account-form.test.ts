import { describe, expect, it } from "vitest";
import { accountFormSchema } from "@/lib/account-form";

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
