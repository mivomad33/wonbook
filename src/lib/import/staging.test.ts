import { describe, expect, it } from "vitest";
import { createTestDb, createTestUser } from "@/db/test-db";
import { MAX_PART_BYTES, splitIntoParts, stagePart, takeStaged } from "./staging";

const TOKEN = "tok_abcdefghijklmnop";

describe("업로드 조각", () => {
  it("크기 한도로 나누고 이으면 원래 글이다(한글이 중간에서 잘리지 않는다)", () => {
    const text = JSON.stringify({ a: "가나다".repeat(100), b: "x".repeat(50) });
    const parts = splitIntoParts(text, 64);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(64);
    expect(parts.join("")).toBe(text);
  });

  it("조각을 모아 읽고 지운다. 다른 사용자는 꺼낼 수 없다", async () => {
    const db = await createTestDb();
    const a = await createTestUser(db);
    const b = await createTestUser(db);
    const parts = splitIntoParts(JSON.stringify({ files: ["한글", 1, 2, 3] }), 8);
    for (const [i, p] of parts.entries()) await stagePart(db, a, TOKEN, i, p);
    await expect(takeStaged(db, b, TOKEN, parts.length)).rejects.toThrow("빠졌습니다");
    expect(await takeStaged(db, a, TOKEN, parts.length)).toEqual({ files: ["한글", 1, 2, 3] });
    await expect(takeStaged(db, a, TOKEN, parts.length)).rejects.toThrow("빠졌습니다");
  });

  it("너무 큰 조각, 잘못된 토큰, 빠진 조각은 받지 않는다", async () => {
    const db = await createTestDb();
    const a = await createTestUser(db);
    await expect(stagePart(db, a, TOKEN, 0, "x".repeat(MAX_PART_BYTES + 1))).rejects.toThrow("너무 큽니다");
    await expect(stagePart(db, a, "short", 0, "x")).rejects.toThrow();
    await stagePart(db, a, TOKEN, 0, '{"a":');
    await expect(takeStaged(db, a, TOKEN, 2)).rejects.toThrow("빠졌습니다");
  });
});
