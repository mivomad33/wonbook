import { describe, expect, it } from "vitest";
import { toAccountKeyRef } from "./account-key";
import { accountKeyHash } from "./account-key-server";

describe("계좌 식별값", () => {
  it("브라우저 값에는 계좌번호가 없고 끝 4자리만 있다", async () => {
    const ref = (await toAccountKeyRef("hana_bank", "111-222222-33333"))!;
    expect(ref.last4).toBe("3333");
    expect(ref.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.digest).not.toContain("11122222233333");
  });

  it("하이픈 있는 번호와 숫자만 있는 번호는 같은 값이 된다", async () => {
    expect(await toAccountKeyRef("kb_bank", "123456-01-234567")).toEqual(await toAccountKeyRef("kb_bank", "12345601234567"));
  });

  it("카드사는 식별값이 없다", async () => {
    expect(await toAccountKeyRef("hana_card", "본인 1234")).toBeNull();
  });

  it("서버 키가 다르면 저장 해시가 달라진다", async () => {
    const { digest } = (await toAccountKeyRef("hana_bank", "111-222222-33333"))!;
    expect(accountKeyHash(digest, "key-a")).not.toBe(accountKeyHash(digest, "key-b"));
    expect(accountKeyHash(digest, "key-a")).toBe(accountKeyHash(digest, "key-a"));
  });

  it("해시 형식이 아니면 받지 않는다", () => {
    expect(() => accountKeyHash("11122222233333", "k")).toThrow();
  });
});
