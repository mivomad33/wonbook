import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, type Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { backupKey, BackupDecryptError, decryptFile, decryptStream, encryptStream, MAGIC, pruneBackups } from "./backup";

// 여러 조각으로 나눠 흘려 스트림 경계(머리글·태그가 조각 사이에 걸리는 경우)도 본다.
async function through(input: Buffer, t: Transform, chunk = 7): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(input.subarray(i, i + chunk));
  const out: Buffer[] = [];
  await pipeline(Readable.from(parts), t, async function* (src: AsyncIterable<Buffer>) {
    for await (const c of src) out.push(c);
  });
  return Buffer.concat(out);
}

const MARKER = "PLAINTEXT-MARKER 가계부 거래 내용";
const plain = Buffer.from(`${MARKER}\n`.repeat(200) + crypto.randomBytes(5000).toString("hex"));
const key = backupKey("test-key-value");

describe("백업 암호화", () => {
  it("암호화한 뒤 같은 키로 풀면 원래 내용이다", async () => {
    const enc = await through(plain, encryptStream(key));
    expect(enc.subarray(0, 4).equals(MAGIC)).toBe(true);
    expect(enc.length).toBe(plain.length + 4 + 12 + 16);
    expect(await through(enc, decryptStream(key), 13)).toEqual(plain);
  });

  it("암호화한 파일에 평문 표시 문자열이 없다", async () => {
    const enc = await through(plain, encryptStream(key));
    expect(enc.includes(Buffer.from(MARKER))).toBe(false);
    expect(enc.includes(Buffer.from("PLAINTEXT"))).toBe(false);
  });

  it("같은 내용도 암호화할 때마다 다르다(IV가 무작위)", async () => {
    const a = await through(plain, encryptStream(key));
    const b = await through(plain, encryptStream(key));
    expect(a.equals(b)).toBe(false);
  });

  it("키가 틀리면 복호화가 실패한다", async () => {
    const enc = await through(plain, encryptStream(key));
    await expect(through(enc, decryptStream(backupKey("other-key")))).rejects.toBeInstanceOf(BackupDecryptError);
  });

  it("내용이 바뀌거나 잘리면 실패한다", async () => {
    const enc = await through(plain, encryptStream(key));
    const flipped = Buffer.from(enc);
    flipped[100] ^= 1;
    await expect(through(flipped, decryptStream(key))).rejects.toBeInstanceOf(BackupDecryptError);
    await expect(through(enc.subarray(0, 20), decryptStream(key))).rejects.toBeInstanceOf(BackupDecryptError);
    await expect(through(Buffer.from("NOPE0000000000000000000000000000"), decryptStream(key))).rejects.toBeInstanceOf(BackupDecryptError);
  });

  it("빈 입력도 암호화·복호화된다", async () => {
    const enc = await through(Buffer.alloc(0), encryptStream(key));
    expect(enc.length).toBe(4 + 12 + 16);
    expect((await through(enc, decryptStream(key))).length).toBe(0);
  });

  it("decryptFile은 키가 틀리면 아무것도 돌려주지 않고 실패한다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-backup-test-"));
    try {
      const f = path.join(dir, "x.dump.enc");
      fs.writeFileSync(f, await through(plain, encryptStream(key)));
      expect(await decryptFile(f, key)).toEqual(plain);
      await expect(decryptFile(f, backupKey("other-key"))).rejects.toBeInstanceOf(BackupDecryptError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("키 값이 없으면 거부한다", () => {
    expect(() => backupKey("")).toThrow();
  });
});

describe("백업 개수 정리", () => {
  it("대상마다 최근 것만 남기고 다른 대상과 다른 파일은 건드리지 않는다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wonbook-prune-test-"));
    try {
      const names = Array.from({ length: 12 }, (_, i) => `prod-202610${String(i + 10).padStart(2, "0")}-120000.dump.enc`);
      for (const n of [...names, "dev-20261001-120000.dump.enc", "note.txt"]) fs.writeFileSync(path.join(dir, n), "x");
      const removed = pruneBackups(dir, "prod", 10).map((f) => path.basename(f));
      expect(removed.sort()).toEqual(names.slice(0, 2));
      expect(fs.readdirSync(dir)).toHaveLength(12);
      expect(fs.existsSync(path.join(dir, "dev-20261001-120000.dump.enc"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
