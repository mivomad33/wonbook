import { describe, expect, it } from "vitest";
import { parseTransactionFilter } from "@/lib/transaction-filter";
import { transactionFormSchema, transferFormSchema } from "@/lib/transaction-form";
import { shiftMonth } from "@/lib/format";

describe("거래 폼 검사", () => {
  it("지출은 음수로, 수입은 양수로 바꾸고 빈 칸을 정리한다", () => {
    const base = { accountId: "3", date: "2026-10-05", time: "", amount: "12000", description: " 편의점 ", memo: " " };
    expect(transactionFormSchema.parse({ ...base, direction: "out" })).toEqual({
      accountId: 3,
      date: "2026-10-05",
      time: null,
      amount: -12_000,
      description: "편의점",
      memo: null,
    });
    expect(transactionFormSchema.parse({ ...base, direction: "in", time: "09:30" })).toMatchObject({ amount: 12_000, time: "09:30" });
  });

  it("계정 없음, 0원, 잘못된 날짜·시각을 막는다", () => {
    const errors = (input: Record<string, string>) => {
      const r = transactionFormSchema.safeParse({ accountId: "1", date: "2026-10-05", direction: "out", amount: "1000", ...input });
      return r.success ? [] : r.error.issues.map((i) => i.path[0]);
    };
    expect(errors({ accountId: "" })).toEqual(["accountId"]);
    expect(errors({ amount: "0" })).toEqual(["amount"]);
    expect(errors({ amount: "" })).toEqual(["amount"]);
    expect(errors({ date: "2026-02-30" })).toEqual(["date"]);
    expect(errors({ time: "25:00" })).toEqual(["time"]);
    // 업로드 거래는 초까지 있다.
    expect(errors({ time: "09:30:15" })).toEqual([]);
  });
});

describe("이체 폼 검사", () => {
  it("같은 계정을 막고, 반대쪽이 없는 이체를 위해 빈 계정은 null로 둔다", () => {
    const base = { date: "2026-10-05", amount: "5000" };
    expect(transferFormSchema.safeParse({ ...base, fromAccountId: "1", toAccountId: "1" }).success).toBe(false);
    expect(transferFormSchema.parse({ ...base, fromAccountId: "1", toAccountId: "" })).toMatchObject({
      fromAccountId: 1,
      toAccountId: null,
      amount: 5_000,
      description: "",
    });
  });
});

describe("거르기 조건", () => {
  it("월이 없거나 잘못되면 이번 달, 잘못된 계정·묶음은 없는 것으로 본다", () => {
    expect(parseTransactionFilter({}, "2026-10")).toEqual({ accountId: null, group: null, month: "2026-10", categoryId: null, showDeleted: false });
    expect(parseTransactionFilter({ category: "none" }, "2026-10").categoryId).toBe("none");
    expect(parseTransactionFilter({ category: "3" }, "2026-10").categoryId).toBe(3);
    expect(parseTransactionFilter({ category: "x" }, "2026-10").categoryId).toBe(null);
    expect(parseTransactionFilter({ account: "x", kind: "foo", month: "2026-13" }, "2026-10")).toMatchObject({
      accountId: null,
      group: null,
      month: "2026-10",
    });
    expect(parseTransactionFilter({ account: "4", kind: "card", month: "all", deleted: "1" }, "2026-10")).toEqual({
      accountId: 4,
      group: "card",
      month: "all",
      categoryId: null,
      showDeleted: true,
    });
  });

  it("달을 넘겨 옮긴다", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});
