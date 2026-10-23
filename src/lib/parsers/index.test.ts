import { describe, expect, it } from "vitest";
import { PARSERS, ParseError, findParser, parseFile } from "./index";
import { KAKAOBANK_PASSWORD_ERROR, UNREADABLE_FILE, UNSUPPORTED_FILE, detectFileKind } from "./read-file";
import { hanaBankSheets, hanaCardSheets, kakaoBankSheets, kbBankSheets, kbCardSheets, kisSheets } from "./test-sheets";

describe("금융사 판별", () => {
  const cases = [
    ["hana_bank", hanaBankSheets([])],
    ["kb_bank", kbBankSheets([])],
    ["kakao_bank", kakaoBankSheets([])],
    ["hana_card", hanaCardSheets([])],
    ["kb_card", kbCardSheets([])],
    ["kis", kisSheets([])],
  ] as const;

  it.each(cases)("%s 파일에는 그 파서 하나만 맞는다", (institution, sheets) => {
    expect(PARSERS.filter((p) => p.matches([...sheets])).map((p) => p.institution)).toEqual([institution]);
  });

  it("맞는 파서가 없으면 지원하지 않는 파일", () => {
    expect(() => findParser([[["아무 표"]]])).toThrow(UNSUPPORTED_FILE);
    expect(() => findParser([])).toThrow(UNSUPPORTED_FILE);
  });
});

describe("파일 종류 판별(내용 기준)", () => {
  const cfb = Buffer.from("d0cf11e0a1b11ae1", "hex");

  it("CFB 시그니처: EncryptionInfo 스트림이 있으면 암호 걸린 xlsx, 없으면 xls", () => {
    expect(detectFileKind(Buffer.concat([cfb, Buffer.alloc(100), Buffer.from("EncryptionInfo", "utf16le")]))).toBe("encrypted_xlsx");
    expect(detectFileKind(Buffer.concat([cfb, Buffer.alloc(100), Buffer.from("Workbook", "utf16le")]))).toBe("xls");
  });

  it("PK면 xlsx, <table이 있으면 HTML, 둘 다 아니면 null", () => {
    expect(detectFileKind(Buffer.from("PK\x03\x04"))).toBe("xlsx");
    expect(detectFileKind(Buffer.from("\n\n<html><TABLE><tr><td>1</td></tr></TABLE>"))).toBe("html");
    expect(detectFileKind(Buffer.from("거래일,금액\n"))).toBeNull();
  });

  it("지원하지 않는 파일은 그 문구로 막는다", async () => {
    await expect(parseFile(Buffer.from("hello"))).rejects.toThrow(UNSUPPORTED_FILE);
  });

  it("종류는 맞는데 읽을 수 없는 파일(손상된 xlsx·xls)은 ParseError로 막는다", async () => {
    for (const broken of [Buffer.from("PK\x03\x04garbage"), Buffer.concat([cfb, Buffer.alloc(600)])]) {
      const error = await parseFile(broken).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ParseError);
      expect(error).toHaveProperty("message", UNREADABLE_FILE);
    }
  });

  it("암호 걸린 파일인데 암호가 없으면 카카오뱅크 암호 오류", async () => {
    const encrypted = Buffer.concat([cfb, Buffer.alloc(100), Buffer.from("EncryptionInfo", "utf16le")]);
    await expect(parseFile(encrypted)).rejects.toThrow(KAKAOBANK_PASSWORD_ERROR);
    await expect(parseFile(encrypted, { password: "000000" })).rejects.toThrow(KAKAOBANK_PASSWORD_ERROR);
  });

  it("HTML 표는 <table>마다 표 하나, 칸은 앞뒤 공백을 지운 글자로 읽는다", async () => {
    const html = kisHtml();
    const parsed = await parseFile(Buffer.from(html));
    expect(parsed.institution).toBe("kis");
    expect(parsed.transactions).toEqual([expect.objectContaining({ date: "2026-07-04", time: "10:00:00", amount: 1_000, balanceAfter: 1_000 })]);
  });
});

// 실제 한국투자증권 파일처럼 rowspan과 줄바꿈이 섞인 HTML(값은 지어낸 것)
function kisHtml() {
  return `
<html><body><h1>입출금거래내역</h1>
<table><tr><th>계좌정보</th><td colspan="3">12345678-01 (홍길동)</td></tr>
<tr><th>거래구분</th><td>전체(입출금)</td><th>검색조건</th><td>전체</td></tr>
<tr><th>조회기간</th><td>2026.07.01
    ~ 2026.07.31</td><th>조회기준 일시</th><td>2026.08.01 10:00:00</td></tr></table>
<table><tr><td></td></tr></table>
<table><tr><th>입금액 합계</th><td>1,000</td><th>수수료 합계</th><td>0</td></tr></table>
<table><tr><td></td></tr></table>
<table>
<tr><td colspan="8">(단위: 원)</td></tr>
<tr><th>거래일</th><th rowspan="2">거래종류</th><th>입금액</th><th rowspan="2">수수료</th><th rowspan="2">잔액</th><th>출금표시내용</th><th>상대계좌</th><th>상대금융기관</th></tr>
<tr><th>거래시각</th><th>출금액</th><th>입금표시내용</th><th>상대계좌명</th><th>거래채널</th></tr>
<tr><td>2026.07.04</td><!--거래일//--><td rowspan="2">예탁금이용료</td><td><span class="num"> 1,000 </span></td><td rowspan="2">0</td><td rowspan="2">1,000</td><td></td><td></td><td></td></tr>
<tr><td>10:00:00</td><td>0</td><td></td><td></td><td></td></tr>
</table></body></html>`;
}
