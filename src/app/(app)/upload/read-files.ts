// 브라우저에서 금융사 파일 읽기(4.3-1). 원본 파일은 서버로 보내지 않고, 읽은 결과를 가리고 해시해 업로드 값으로 만든다.
// 파서는 Node의 Buffer를 쓰므로 브라우저에서는 buffer 패키지로 채운 뒤 불러온다.
import type { UploadedFile } from "@/lib/import/payload";

export type ReadOutcome = { status: "ok"; file: UploadedFile } | { status: "needs_password" } | { status: "error"; message: string };

// 지원 금융사 안내(4.3-6). 지원하지 않는 파일 오류에 붙인다.
export const SUPPORTED_TEXT = "하나은행, 국민은행, 카카오뱅크, 하나카드, 국민카드, 한국투자증권(일반·ISA)";

let ready: Promise<typeof import("./read-files-impl")> | undefined;

async function load() {
  ready ??= (async () => {
    const { Buffer } = await import("buffer");
    (globalThis as unknown as { Buffer?: unknown }).Buffer ??= Buffer;
    return import("./read-files-impl");
  })();
  return ready;
}

export async function readUploadFile(file: File, password?: string): Promise<ReadOutcome> {
  const impl = await load();
  return impl.readUploadFile(file, password);
}
