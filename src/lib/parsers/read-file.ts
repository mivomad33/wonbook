// 파일 → 표 목록(3단계 파일 1.1의 1·2). 금융사와 상관없는 공통 코드다.
import * as cheerio from "cheerio";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";
import { ParseError, text } from "./common";
import type { Sheet } from "./types";

export type FileKind = "encrypted_xlsx" | "xls" | "xlsx" | "html";

const CFB_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");
// CFB 디렉터리 항목 이름은 UTF-16LE로 저장된다.
const ENCRYPTION_INFO = Buffer.from("EncryptionInfo", "utf16le");

export const UNSUPPORTED_FILE = "지원하지 않는 파일입니다";
export const UNREADABLE_FILE = "파일을 읽을 수 없습니다(파일이 손상됐을 수 있습니다)";
export const KAKAOBANK_PASSWORD_ERROR = "카카오뱅크 파일 암호가 없거나 맞지 않습니다.";

// 확장자가 아니라 내용으로 판별한다(0단계 파일 2.4). 한국투자증권 파일은 확장자가 xls인 HTML이다.
export function detectFileKind(buf: Buffer): FileKind | null {
  if (buf.subarray(0, 8).equals(CFB_SIGNATURE)) return buf.includes(ENCRYPTION_INFO) ? "encrypted_xlsx" : "xls";
  if (buf.subarray(0, 2).toString("latin1") === "PK") return "xlsx";
  if (/<table/i.test(buf.toString("utf8"))) return "html";
  return null;
}

function readWorkbook(buf: Buffer): Sheet[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  return wb.SheetNames.map((name) =>
    XLSX.utils.sheet_to_json<Sheet[number]>(wb.Sheets[name], { header: 1, defval: "", raw: true, blankrows: true }),
  );
}

// `<table>`마다 표 하나, `<tr>`마다 행 하나. rowspan은 펼치지 않는다(한국투자증권 파서가 위치로 처리한다).
function readHtmlTables(buf: Buffer): Sheet[] {
  const $ = cheerio.load(buf.toString("utf8"));
  return $("table")
    .toArray()
    .map((table) =>
      $(table)
        .find("tr")
        .toArray()
        .map((tr) =>
          $(tr)
            .children("td, th")
            .toArray()
            .map((cell) => text($(cell).text())),
        ),
    );
}

// 카카오뱅크 암호는 인자로 받는다. 파서는 .env.local을 직접 읽지 않는다(1.2 비밀 값).
// 종류는 맞는데 라이브러리가 읽다가 실패하면(손상된 파일) ParseError로 바꾼다. 일반 오류는 서버 액션이 그대로 던져
// 같이 올린 다른 파일까지 막히기 때문이다(3단계 파일 5.1).
export async function readSheets(input: Uint8Array, options: { password?: string } = {}): Promise<Sheet[]> {
  try {
    return await readSheetsByKind(Buffer.from(input), options);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(UNREADABLE_FILE);
  }
}

async function readSheetsByKind(buf: Buffer, options: { password?: string }): Promise<Sheet[]> {
  switch (detectFileKind(buf)) {
    case "encrypted_xlsx": {
      if (!options.password) throw new ParseError(KAKAOBANK_PASSWORD_ERROR);
      let decrypted: Buffer;
      try {
        decrypted = await officeCrypto.decrypt(buf, { password: options.password });
      } catch {
        throw new ParseError(KAKAOBANK_PASSWORD_ERROR);
      }
      return readWorkbook(decrypted);
    }
    case "xls":
    case "xlsx":
      return readWorkbook(buf);
    case "html":
      return readHtmlTables(buf);
    case null:
      throw new ParseError(UNSUPPORTED_FILE);
  }
}
