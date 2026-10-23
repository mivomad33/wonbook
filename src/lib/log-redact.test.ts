import { describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { describeError, installLogRedaction, redactText } from "./log-redact";

const SECRET_TEXT = ["가짜가게-로그확인", "secret-person@test.local", "123456789"];

describe("서버 로그에서 사용자 데이터 지우기(4.7-3)", () => {
  it("실제 DB 쿼리 실패 오류에서 쿼리 값과 Postgres 오류의 값이 빠지고 종류와 위치는 남는다", async () => {
    const db = await createTestDb();
    await db.insert(users).values({ email: SECRET_TEXT[1], name: SECRET_TEXT[0] });
    let caught: unknown;
    try {
      await db.insert(users).values({ email: SECRET_TEXT[1], name: SECRET_TEXT[0] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const raw = `${(caught as Error).message} ${String((caught as { cause?: Error }).cause?.message)}`;
    expect(raw).toContain(SECRET_TEXT[1]); // 지우기 전에는 값이 들어 있다
    const out = describeError(caught as Error);
    for (const s of SECRET_TEXT) expect(out).not.toContain(s);
    expect(out).toMatch(/Failed query: \(쿼리와 값 생략\)/);
    expect(out).toMatch(/\n\s+at /);
  });

  it("문자열 로그의 쿼리와 키 값을 지우고, 우리 로그 문구는 그대로 둔다", () => {
    expect(redactText(`Failed query: insert into "users" values ($1)\nparams: ${SECRET_TEXT[1]}`)).not.toContain(SECRET_TEXT[1]);
    expect(redactText(`Key (email)=(${SECRET_TEXT[1]}) already exists.`)).toBe("Key (email)=(생략) already exists.");
    expect(redactText("[db] 연결 오류: Error")).toBe("[db] 연결 오류: Error");
  });

  it("console.error를 감싸면 오류 객체의 값이 출력에 남지 않는다", () => {
    const lines: unknown[][] = [];
    const fake = { error: (...a: unknown[]) => lines.push(a), warn: () => {}, log: () => {}, info: () => {} } as unknown as Console;
    installLogRedaction(fake);
    installLogRedaction(fake);
    const e = new Error(`Failed query: select 1\nparams: ${SECRET_TEXT[0]}`, { cause: new Error(`invalid input syntax for type bigint: "${SECRET_TEXT[2]}"`) });
    fake.error("⨯", e);
    expect(lines).toHaveLength(1);
    const printed = JSON.stringify(lines[0]);
    for (const s of SECRET_TEXT) expect(printed).not.toContain(s);
    expect(printed).toContain("invalid input syntax for type bigint");
  });
});
