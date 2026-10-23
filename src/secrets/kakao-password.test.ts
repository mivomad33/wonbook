import { beforeEach, describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { createTestDb, createTestUser } from "@/db/test-db";
import { decryptPassword, encryptPassword, hasKakaoPassword, loadKakaoPassword, saveKakaoPassword } from "./kakao-password";

describe("카카오뱅크 암호 저장", () => {
  beforeEach(() => {
    process.env.PASSWORD_ENCRYPTION_KEY = "test-key-a";
  });

  it("DB에 평문이 없고, 그 사용자만 되돌려 받는다", async () => {
    const db = await createTestDb();
    const a = await createTestUser(db);
    const b = await createTestUser(db);
    await saveKakaoPassword(db, a, "870101");
    const rows = await db.select().from(users);
    expect(JSON.stringify(rows)).not.toContain("870101");
    expect(await loadKakaoPassword(db, a)).toBe("870101");
    expect(await loadKakaoPassword(db, b)).toBeNull();
    expect(await hasKakaoPassword(db, b)).toBe(false);
  });

  it("암호화 키가 바뀌면 복호화하지 않는다", async () => {
    const enc = encryptPassword("870101", "key-1");
    expect(decryptPassword(enc, "key-1")).toBe("870101");
    expect(decryptPassword(enc, "key-2")).toBeNull();
  });

  it("같은 암호도 매번 다른 값으로 저장된다", () => {
    expect(encryptPassword("870101", "k")).not.toBe(encryptPassword("870101", "k"));
  });

  it("64자를 넘으면 저장하지 않는다", async () => {
    const db = await createTestDb();
    const a = await createTestUser(db);
    await expect(saveKakaoPassword(db, a, "x".repeat(65))).rejects.toThrow();
  });
});
