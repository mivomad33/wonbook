// samples/의 실제 파일 테스트(design.md 4.2). samples/는 개인정보라 커밋하지 않으므로, 없으면 건너뛴다.
// 정답 데이터를 커밋하지 않고 불변식(잔액, 파일 안의 합계)으로 검사한다.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/test-db";
import { accounts, type Institution, transactions } from "@/db/schema";
import { getBalance } from "@/lib/balance";
import { applyImport, normalizeAccountKey, openingFromFile } from "@/lib/import";
import { text, toNumber } from "./common";
import { findParser } from "./index";
import { readSheets } from "./read-file";
import type { ParsedFile, Sheet } from "./types";

const SAMPLES_DIR = path.join(process.cwd(), "samples");
const hasSamples = fs.existsSync(SAMPLES_DIR);

// 앱은 서버 액션이 process.env에서 읽어 넘긴다. 테스트는 .env.local에서 같은 값을 읽어 넘긴다.
function kakaoPassword() {
  const envFile = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envFile)) return undefined;
  return parseEnv(fs.readFileSync(envFile, "utf8")).KAKAOBANK_FILE_PASSWORD;
}

// 파일명 앞부분 → 기대하는 금융사. 파서는 파일명을 쓰지 않고, 테스트가 판별 결과를 맞춰 보는 데만 쓴다.
const SAMPLES: { prefix: string; institution: Institution }[] = [
  { prefix: "하나은행_", institution: "hana_bank" },
  { prefix: "하나은행청약_", institution: "hana_bank" },
  { prefix: "KB_", institution: "kb_bank" },
  { prefix: "카카오뱅크_", institution: "kakao_bank" },
  { prefix: "하나카드_", institution: "hana_card" },
  { prefix: "국민카드_", institution: "kb_card" },
  { prefix: "한투_trade", institution: "kis" },
  { prefix: "한투_ISA_", institution: "kis" },
];

async function load(prefix: string): Promise<{ sheets: Sheet[]; parsed: ParsedFile }> {
  // macOS 파일명은 NFD라 NFC로 맞춰 비교한다.
  const name = fs.readdirSync(SAMPLES_DIR).find((f) => f.normalize("NFC").startsWith(prefix));
  if (!name) throw new Error(`samples/에 ${prefix} 파일이 없습니다`);
  const sheets = await readSheets(fs.readFileSync(path.join(SAMPLES_DIR, name)), { password: kakaoPassword() });
  return { sheets, parsed: findParser(sheets).parse(sheets) };
}

// 앞 거래의 거래 후 잔액 + 이번 금액 = 이번 거래의 거래 후 잔액
function expectBalanceChain(parsed: ParsedFile) {
  const txs = parsed.transactions;
  for (let i = 1; i < txs.length; i++) {
    expect(txs[i - 1].balanceAfter! + txs[i].amount, `${i}번째 거래(${txs[i].date})`).toBe(txs[i].balanceAfter);
  }
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const inflow = (p: ParsedFile) => sum(p.transactions.filter((t) => t.amount > 0).map((t) => t.amount));
const outflow = (p: ParsedFile) => sum(p.transactions.filter((t) => t.amount < 0).map((t) => -t.amount));

// 한 표에서 이름표 칸 오른쪽의 숫자
function labeledNumber(sheet: Sheet, label: string) {
  for (const row of sheet) {
    const i = row.findIndex((c) => text(c) === label);
    if (i >= 0) return toNumber(row[i + 1], label);
  }
  throw new Error(`${label}이(가) 없습니다`);
}

describe.skipIf(!hasSamples)("실제 샘플 파일(samples/)", () => {
  it.each(SAMPLES)("$prefix: 맞는 금융사로 판별되고 공통 조건을 지킨다", async ({ prefix, institution }) => {
    const { parsed } = await load(prefix);
    expect(parsed.institution).toBe(institution);
    expect(parsed.transactions.length).toBeGreaterThan(0);
    for (const t of parsed.transactions) {
      expect(t.date >= parsed.period.start && t.date <= parsed.period.end).toBe(true);
      expect(Number.isInteger(t.amount) && t.amount !== 0).toBe(true);
      expect(t.description).not.toBe("");
    }
    expect(parsed.transactions.map((t) => t.date)).toEqual(parsed.transactions.map((t) => t.date).toSorted());
    if (institution.endsWith("_card")) expect(parsed.accountKey).toBeNull();
    else expect(parsed.accountKey).toMatch(/\d{4}/);
  });

  it.each(["하나은행_", "하나은행청약_", "KB_", "카카오뱅크_", "한투_ISA_"])("%s: 잔액 불변식이 모든 거래에서 맞는다", async (prefix) => {
    expectBalanceChain((await load(prefix)).parsed);
  });

  it("하나은행·국민은행: 입금·출금 합계가 파일 끝 합계 행과 같다", async () => {
    for (const prefix of ["하나은행_", "하나은행청약_", "KB_"]) {
      const { sheets, parsed } = await load(prefix);
      const totalRow = sheets[0].findLast((row) => row.some((c) => ["합 계", "합계"].includes(text(c))))!;
      const [outTotal, inTotal] = totalRow.filter((c) => typeof c === "number");
      expect(outflow(parsed), prefix).toBe(outTotal);
      expect(inflow(parsed), prefix).toBe(inTotal);
    }
  });

  it("한국투자증권 일반: 입금·출금 합계가 셋째 표의 합계와 같다", async () => {
    const { sheets, parsed } = await load("한투_trade");
    expect(inflow(parsed)).toBe(labeledNumber(sheets[2], "입금액 합계"));
    expect(outflow(parsed)).toBe(labeledNumber(sheets[2], "출금액 합계"));
  });

  it("하나카드: 넣은 거래 수가 정상승인건수와 같다", async () => {
    const { sheets, parsed } = await load("하나카드_");
    const countRow = sheets[0].find((row) => text(row[0]) === "정상승인건수")!;
    expect(parsed.transactions.length).toBe(countRow.find((c) => typeof c === "number"));
  });

  it("국민카드: 결제 건수와 환불 합계가 머리 요약과 같다", async () => {
    const { sheets, parsed } = await load("국민카드_");
    // 요약: 3행 `국내 466 / 18`, `18,302,237 / 629,086`, 4행 `해외 9 / 0`
    const [domesticCount] = text(sheets[0][3][2]).split("/").map((s) => toNumber(s, "요약"));
    const [overseasCount] = text(sheets[0][4][2]).split("/").map((s) => toNumber(s, "요약"));
    const [, cancelAmount] = text(sheets[0][3][9]).split("/").map((s) => toNumber(s, "요약"));
    expect(parsed.transactions.filter((t) => t.amount < 0).length).toBe(domesticCount + overseasCount);
    expect(inflow(parsed)).toBe(cancelAmount);
    expect(parsed.transactions.filter((t) => t.method?.includes("해외(어림)")).length).toBe(overseasCount);
  });

  // 업로드 반영(3-3)과 보정(4-2)을 실제 파일로 확인한다. "계정 만들고 올리기"(3단계 파일 3장)처럼 기초 잔액을 파일에서 채운다.
  it.each(SAMPLES)("$prefix: 새 계정에 반영하면 두 번 올려도 거래 수가 같고, 보정 뒤 잔액이 파일의 마지막 잔액과 같다", async ({ prefix }) => {
    const { parsed } = await load(prefix);
    const db = createTestDb();
    const accountId = db
      .insert(accounts)
      .values({
        name: prefix,
        kind: parsed.institution.endsWith("_card") ? "card" : "asset",
        institution: parsed.institution,
        externalKey: normalizeAccountKey(parsed.institution, parsed.accountKey),
        ...openingFromFile(parsed),
      })
      .returning()
      .get().id;
    // 한국투자증권 일반은 매매·세금 때문에 잔액이 거래와 맞지 않는 날이 6일이라 보정 6건이 생긴다(4단계 파일 머리).
    // 나머지는 기초 잔액을 파일에서 채우므로 보정이 생기지 않는다.
    const adjustmentCount = prefix === "한투_trade" ? 6 : 0;
    for (let i = 0; i < 2; i++) {
      const result = applyImport(db, { accountId, fileName: prefix, parsed, confirmedIds: [], backupPath: null });
      expect(result).toMatchObject({
        status: "applied",
        insertedCount: parsed.transactions.length,
        // 두 번째는 같은 보정이 created_at을 이어받아 새로 생긴 것이 없다.
        newAdjustments: { count: i === 0 ? adjustmentCount : 0 },
      });
    }
    const rows = db.select().from(transactions).all();
    expect(rows.filter((r) => r.kind === "normal")).toHaveLength(parsed.transactions.length);
    expect(rows.filter((r) => r.kind === "adjustment")).toHaveLength(adjustmentCount);
    const last = parsed.transactions.at(-1)!.balanceAfter;
    if (last != null) expect(getBalance(db, accountId)).toBe(last);
  });
});
