// read-files.ts가 Buffer를 채운 뒤에 불러오는 실제 읽기. 직접 불러 쓰지 않는다.
import { toUploadedFile } from "@/lib/import/payload";
import { ParseError, parseFile } from "@/lib/parsers";
import { detectFileKind, KAKAOBANK_PASSWORD_ERROR, UNSUPPORTED_FILE } from "@/lib/parsers/read-file";
import { type ReadOutcome, SUPPORTED_TEXT } from "./read-files";

export async function readUploadFile(file: File, password?: string): Promise<ReadOutcome> {
  const data = new Uint8Array(await file.arrayBuffer());
  const encrypted = detectFileKind(Buffer.from(data)) === "encrypted_xlsx";
  if (encrypted && !password) return { status: "needs_password" };
  try {
    const parsed = await parseFile(data, { password });
    return { status: "ok", file: await toUploadedFile(file.name, parsed) };
  } catch (e) {
    if (!(e instanceof ParseError)) return { status: "error", message: "파일을 읽을 수 없습니다(파일이 손상됐을 수 있습니다)" };
    if (encrypted && e.message === KAKAOBANK_PASSWORD_ERROR) return { status: "needs_password" };
    if (e.message === UNSUPPORTED_FILE) return { status: "error", message: `${UNSUPPORTED_FILE}. 지금은 ${SUPPORTED_TEXT} 파일만 읽습니다.` };
    return { status: "error", message: e.message };
  }
}
