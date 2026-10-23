import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import { accounts, imports } from "@/db/schema";
import { applyImport } from "@/lib/import";
import { backupDirFor, createBackup, listBackups } from "@/lib/import/backup";

// 테스트는 임시 폴더에 백업하고 앱 백업 폴더(data/backups/)를 건드리지 않는다(3단계 파일 6장).
const dirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-backup-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const at = (s: string) => new Date(`2026-10-19T${s}`);

describe("백업", () => {
  it("DB 경로마다 폴더를 나눈다", () => {
    expect(backupDirFor("/app/data/wonbook.db")).toBe("/app/data/backups/wonbook");
    expect(backupDirFor("/app/data/dev.db")).toBe("/app/data/backups/dev");
  });

  it("DB 복사본을 만들고 imports.backup_path에 남긴다", () => {
    const db = createTestDb();
    const accountId = db.insert(accounts).values({ name: "하나", kind: "asset", institution: "hana_bank", externalKey: "1" }).returning().get().id;
    const dir = tempDir();
    const file = createBackup(db, dir, { now: at("14:03:00") });
    expect(path.basename(file)).toBe("20261019-140300.db");

    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("select name from accounts").all()).toEqual([{ name: "하나" }]);
    copy.close();

    applyImport(db, {
      accountId,
      fileName: "하나.xls",
      parsed: { institution: "hana_bank", accountKey: "1", period: { start: "2026-10-01", end: "2026-10-31" }, transactions: [] },
      confirmedIds: [],
      backupPath: file,
    });
    expect(db.select().from(imports).get()?.backupPath).toBe(file);
  });

  it("같은 초에 두 번 만들면 -2를 붙이고, 정한 개수를 넘으면 오래된 것부터 지운다", () => {
    const db = createTestDb();
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "메모.txt"), "남겨야 하는 파일");
    createBackup(db, dir, { now: at("14:00:01"), keep: 3 });
    createBackup(db, dir, { now: at("14:00:00"), keep: 3 });
    createBackup(db, dir, { now: at("14:00:00"), keep: 3 });
    const names = () => listBackups(dir).map((f) => path.basename(f));
    expect(names()).toEqual(["20261019-140000.db", "20261019-140000-2.db", "20261019-140001.db"]);

    // 같은 초의 두 백업 중 먼저 만든 것(-2 없는 것)을 먼저 지운다.
    createBackup(db, dir, { now: at("14:00:02"), keep: 3 });
    expect(names()).toEqual(["20261019-140000-2.db", "20261019-140001.db", "20261019-140002.db"]);
    createBackup(db, dir, { now: at("14:00:03"), keep: 3 });
    expect(names()).toEqual(["20261019-140001.db", "20261019-140002.db", "20261019-140003.db"]);
    expect(fs.existsSync(path.join(dir, "메모.txt"))).toBe(true);
  });
});
