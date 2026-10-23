import { describe, expect, it } from "vitest";
import { INSTITUTIONS } from "@/db/schema";
import { INSTITUTION_LABELS } from "@/lib/labels";
import { SUPPORTED_GROUPS } from "./supported";

describe("지원 금융사 안내", () => {
  it("파서가 지원하는 금융사와 같다", () => {
    const shown = SUPPORTED_GROUPS.flatMap((g) => g.items.map((n) => n.replace(/ \(.*\)$/, "")));
    expect(shown.sort()).toEqual(INSTITUTIONS.map((i) => INSTITUTION_LABELS[i]).sort());
  });
});
