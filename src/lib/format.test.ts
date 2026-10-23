import { describe, expect, it } from "vitest";
import { currentMonth, today, toDateString } from "./format";

// 서버 시간대와 상관없이 한국 시간으로 날짜를 정한다(4.2-3). package.json의 test가 TZ=UTC로 돈다.
describe("한국 시간 날짜 경계", () => {
  it("한국 시간 23:59는 그날, 00:00은 다음 날이다", () => {
    expect(toDateString(new Date("2026-10-23T14:59:00Z"))).toBe("2026-10-23"); // KST 23:59
    expect(toDateString(new Date("2026-10-23T15:00:00Z"))).toBe("2026-10-24"); // KST 00:00
  });

  it("매달 1일 00:00에 이번 달이 바뀐다", () => {
    expect(currentMonth(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10");
    expect(currentMonth(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11");
    expect(today(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});
