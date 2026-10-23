// 데모 데이터에 금지 문자열과 내 계좌 식별값이 없다(4.5-2). 기준은 비공개 파일에서 읽으므로 없으면(CI) 건너뛴다.
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensureDemoUser } from "@/auth/demo";
import { createTestDb } from "@/db/test-db";
import { loadBasis, ROOT, scanText } from "./basis";

const hasBasis = ["docs/checks/forbidden-strings.txt", ".env.local", "data/wonbook.db"].every((f) => fs.existsSync(path.join(ROOT, f)));

describe.skipIf(!hasBasis)("데모 데이터 검사(4.5-2)", () => {
  it("데모 사용자의 모든 행에 금지 문자열·비밀 값·내 계좌 식별값이 없다", async () => {
    const db = await createTestDb();
    await ensureDemoUser(db, new Date("2026-10-23T03:00:00Z"));
    const tables = ["users", "accounts", "imports", "transactions", "categories", "category_rules", "settings"];
    const union = tables.map((t) => `select row_to_json(x)::text as j from ${t} x`).join(" union all ");
    const r = (await db.execute(sql.raw(`select string_agg(j, E'\\n') as s from (${union}) q`))) as unknown as { rows: { s: string }[] };
    const dump = r.rows[0].s;
    expect(dump).toContain("demo@wonbook.invalid");
    expect(scanText(dump, loadBasis({ accountIds: true }))).toEqual({ forbidden: 0, secret: 0, account: 0 });
  });
});
