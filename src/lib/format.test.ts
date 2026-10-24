import { describe, expect, it } from "vitest";
import { currentMonth, formatDayHeader, today, toDateString } from "./format";

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

// 거래 목록의 날짜 머리줄(design-refresh 명세서 4.4-2). 요일은 날짜 값으로 계산해 시간대에 따라 바뀌지 않는다.
describe("날짜 머리줄", () => {
  it("월·일과 요일을 보여 준다", () => {
    expect(formatDayHeader("2026-10-23")).toBe("10월 23일 (금)");
    expect(formatDayHeader("2026-01-04")).toBe("1월 4일 (일)");
    expect(formatDayHeader("2024-02-29")).toBe("2월 29일 (목)");
  });
});
