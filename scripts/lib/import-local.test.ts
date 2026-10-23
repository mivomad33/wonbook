import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { accounts, importUndo, imports, transactions, users } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { compareImport } from "./import-compare";
import { importLocal, openLocal } from "./import-local";

// 예전 로컬 앱 DB(SQLite) 스키마. 값은 모두 지어낸 것이다.
const OLD_SCHEMA = `
CREATE TABLE accounts (id integer PRIMARY KEY NOT NULL, name text NOT NULL, kind text NOT NULL, institution text, external_key text,
  opening_balance integer DEFAULT 0 NOT NULL, opening_date text, sort_order integer DEFAULT 0 NOT NULL, created_at text NOT NULL);
CREATE TABLE categories (id integer PRIMARY KEY NOT NULL, name text NOT NULL, parent_id integer, "group" text NOT NULL, sort_order integer DEFAULT 0 NOT NULL, created_at text NOT NULL);
CREATE TABLE category_rules (id integer PRIMARY KEY NOT NULL, match_key text NOT NULL, category_id integer NOT NULL, source text NOT NULL, updated_at text NOT NULL, created_at text NOT NULL);
CREATE TABLE imports (id integer PRIMARY KEY NOT NULL, account_id integer NOT NULL, file_name text NOT NULL, period_start text NOT NULL, period_end text NOT NULL,
  inserted_count integer NOT NULL, deleted_count integer NOT NULL, backup_path text, created_at text NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY NOT NULL, value text NOT NULL, created_at text NOT NULL);
CREATE TABLE transactions (id integer PRIMARY KEY NOT NULL, account_id integer NOT NULL, kind text NOT NULL, source text NOT NULL, date text NOT NULL, time text, seq integer,
  amount integer NOT NULL, description text DEFAULT '' NOT NULL, method text, memo text, card_label text, balance_after integer, raw text, import_id integer,
  transfer_peer_id integer, category_id integer, category_source text, edited_at text, deleted_at text, created_at text NOT NULL);
`;

const C = "2026-10-01T00:00:00.000Z";
const BANK_NO = "111-222222-33333";
const OTHER_NO = "987-654321-12345";

let dir: string | undefined;
afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

function fakeLocalDb(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-import-"));
  const file = path.join(dir, "old.db");
  const db = new Database(file);
  db.exec(OLD_SCHEMA);
  const ins = (table: string, row: Record<string, unknown>) =>
    db.prepare(`insert into ${table} (${Object.keys(row).map((k) => `"${k}"`).join(",")}) values (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  ins("categories", { id: 3, name: "장보기", parent_id: null, group: "expense", sort_order: 1, created_at: C });
  ins("categories", { id: 7, name: "급여", parent_id: null, group: "income", sort_order: 1, created_at: C });
  ins("categories", { id: 9, name: "마트", parent_id: 3, group: "expense", sort_order: 1, created_at: C });
  ins("categories", { id: 12, name: "내 계좌 이동", parent_id: null, group: "move", sort_order: 1, created_at: C });
  ins("accounts", { id: 1, name: "가짜 통장", kind: "asset", institution: "hana_bank", external_key: BANK_NO, opening_balance: 50_000, opening_date: "2026-08-01", sort_order: 0, created_at: C });
  ins("accounts", { id: 2, name: "가짜 카카오", kind: "asset", institution: "kakao_bank", external_key: "1234", opening_balance: 0, opening_date: "2026-08-01", sort_order: 1, created_at: C });
  ins("accounts", { id: 4, name: "가짜 카드", kind: "card", institution: "hana_card", external_key: null, opening_balance: 0, opening_date: null, sort_order: 0, created_at: C });
  ins("accounts", { id: 5, name: "가짜 대출", kind: "liability", institution: null, external_key: null, opening_balance: -1_000_000, opening_date: "2026-08-01", sort_order: 0, created_at: C });
  ins("imports", { id: 1, account_id: 1, file_name: `거래내역_${OTHER_NO.replaceAll("-", "")}.xlsx`, period_start: "2026-08-01", period_end: "2026-10-31", inserted_count: 3, deleted_count: 0, backup_path: "/x/backup.db", created_at: C });
  const tx = (row: Record<string, unknown>) =>
    ins("transactions", { kind: "normal", source: "upload", time: null, seq: null, method: null, memo: null, card_label: null, balance_after: null, raw: '{"x":1}', import_id: null, transfer_peer_id: null, category_id: null, category_source: null, edited_at: null, deleted_at: null, created_at: C, ...row });
  tx({ id: 10, account_id: 1, date: "2026-10-03", amount: 200_000, description: "가짜급여", import_id: 1, category_id: 7, category_source: "ai" });
  tx({ id: 11, account_id: 1, date: "2026-10-05", amount: -30_000, description: "가짜마트", import_id: 1, category_id: 9, category_source: "saved" });
  tx({ id: 12, account_id: 1, date: "2026-10-06", amount: -20_000, description: `청약 ${OTHER_NO}`, memo: `메모 ${OTHER_NO}`, import_id: 1 });
  tx({ id: 13, account_id: 1, date: "2026-09-10", amount: -5_000, description: "지운 거래", deleted_at: C, import_id: 1 });
  tx({ id: 14, account_id: 1, date: "2026-10-07", amount: -10_000, kind: "transfer", source: "manual", description: "이체", transfer_peer_id: 15 });
  tx({ id: 15, account_id: 2, date: "2026-10-07", amount: 10_000, kind: "transfer", source: "manual", description: "이체", transfer_peer_id: 14 });
  tx({ id: 16, account_id: 2, date: "2026-10-08", amount: 333, kind: "adjustment", source: "system", description: "잔액 보정" });
  tx({ id: 17, account_id: 4, date: "2026-09-20", amount: -12_000, description: "가짜카페", card_label: "본인 1234", category_id: 3, category_source: "user", edited_at: C });
  tx({ id: 18, account_id: 5, date: "2026-08-20", amount: 100_000, description: "상환", source: "manual" });
  ins("category_rules", { id: 1, match_key: "가짜마트", category_id: 9, source: "user", updated_at: C, created_at: C });
  ins("settings", { key: "adjustment_notice_dismissed_at", value: JSON.stringify(C), created_at: C });
  db.close();
  return file;
}

const NOW = new Date("2026-10-23T03:00:00Z");
const EMAIL = "admin@test.local";

describe("내 데이터 이전(4.8-3)", () => {
  it("관리자 계정을 만들어 옮기고, 계좌번호는 해시·끝 4자리로, 글 칸의 계좌번호는 가린다", async () => {
    const db = await createTestDb();
    const local = openLocal(fakeLocalDb());
    const r = await importLocal(db, local, { email: EMAIL });
    expect(r.status).toBe("imported");
    expect(r.counts).toMatchObject({ accounts: 4, categories: 4, imports: 1, transactions: 9, rules: 1, settings: 1 });

    const [admin] = await db.select().from(users).where(eq(users.id, r.userId));
    expect(admin).toMatchObject({ email: EMAIL, googleSub: null, isDemo: false });
    const acc = await db.select().from(accounts).where(eq(accounts.userId, r.userId));
    const bank = acc.find((a) => a.name === "가짜 통장")!;
    expect(bank.externalKeyLast4).toBe("3333");
    expect(bank.externalKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.find((a) => a.name === "가짜 카카오")!.externalKeyLast4).toBe("1234");
    expect(acc.find((a) => a.name === "가짜 카드")!.externalKeyHash).toBeNull();

    const dump = JSON.stringify(await db.execute(sql`select row_to_json(t)::text from transactions t union all select row_to_json(i)::text from imports i union all select row_to_json(a)::text from accounts a`));
    for (const n of [BANK_NO, OTHER_NO, OTHER_NO.replaceAll("-", ""), "222222", "654321"]) expect(dump).not.toContain(n);
    expect(dump).toContain("****2345");
    expect(dump).not.toContain("backup.db");
    expect(dump).not.toContain('\\"x\\"');
    // 옮긴 업로드는 되돌릴 수 없다
    expect(await db.select().from(importUndo)).toEqual([]);
    const [peer] = await db.select().from(transactions).where(eq(transactions.description, "이체")).limit(1);
    expect(peer.transferPeerId).not.toBeNull();
    expect((await db.select().from(imports))[0].fileName).toMatch(/\*\*\*\*2345/);

    const checks = await compareImport(db, r.userId, local, NOW);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBe(7);
    local.close();
  });

  it("다시 실행하면 옮기지 않고 거래 수가 그대로다", async () => {
    const db = await createTestDb();
    const local = openLocal(fakeLocalDb());
    const first = await importLocal(db, local, { email: EMAIL });
    const second = await importLocal(db, local, { email: EMAIL });
    expect(second).toMatchObject({ status: "already", userId: first.userId });
    expect((await db.select().from(transactions)).length).toBe(9);
    local.close();
  });

  it("미리 있는 관리자 계정(데이터 없음)에 옮긴다", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: EMAIL }).returning();
    const local = openLocal(fakeLocalDb());
    expect((await importLocal(db, local, { email: EMAIL })).userId).toBe(u.id);
    local.close();
  });

  it("옮긴 값이 다르면 비교가 실패한다", async () => {
    const db = await createTestDb();
    const local = openLocal(fakeLocalDb());
    const r = await importLocal(db, local, { email: EMAIL });
    await db.update(transactions).set({ amount: -31_000 }).where(eq(transactions.description, "가짜마트"));
    const failed = (await compareImport(db, r.userId, local, NOW)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toContain("자산 현황(계정별 잔액, 자산·부채 합계, 순자산)");
    expect(failed).toContain("월별 수입/지출 2026-10(합계와 카테고리별 금액)");
    expect(failed.some((n) => n.startsWith("계정별 거래 수"))).toBe(true);
    local.close();
  });
});
