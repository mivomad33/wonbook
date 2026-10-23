// 업로드 값 나누기(4.3-2). 브라우저가 쓰므로 DB 코드를 두지 않는다.

// 조각 하나의 글 크기(UTF-8 바이트). 전송 때 따옴표가 이스케이프되어 커져도 4MB 서버 동작 한도 안에 들게 3MB로 둔다.
export const MAX_PART_BYTES = 3_000_000;
// 한 업로드의 조각 수. 거래 10,000건에 칸마다 한글 200자여도 들어간다.
export const MAX_PARTS = 20;

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** 업로드 값을 조각으로 나눈다. 글자 중간에서 자르지 않는다. */
export function splitIntoParts(text: string, maxBytes = MAX_PART_BYTES): string[] {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of text) {
    const b = ch.length === 1 && ch.charCodeAt(0) < 0x80 ? 1 : utf8Bytes(ch);
    if (size + b > maxBytes && current) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += b;
  }
  if (current || parts.length === 0) parts.push(current);
  return parts;
}
