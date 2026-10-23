// 서버 로그에 사용자 데이터가 남지 않게 한다(4.7-3). 오류는 종류와 위치(스택)만 남긴다.
// DB 쿼리가 실패하면 drizzle 오류 메시지에 SQL과 값(거래 내용, 금액, 이메일, 해시, 암호문)이 들어가고,
// Postgres 오류에도 값이 따옴표나 "Key (..)=(..)" 꼴로 들어간다. Next.js가 처리하지 못한 오류를 console.error로 남기므로,
// 서버가 시작할 때(instrumentation.ts) 콘솔 출력을 감싸 이런 부분을 지운다.
const QUERY = /Failed query:[\s\S]*?(?=\n\s+at |$)/g;
const KEY_VALUE = /\(([^()\n]*)\)=\(([^()\n]*)\)/g;
const QUOTED = /"[^"\n]*"|'[^'\n]*'/g;

/** 문자열 로그: 쿼리와 키 값만 지운다(우리 코드의 로그 문구는 그대로 둔다). */
export function redactText(text: string): string {
  return text.replace(QUERY, "Failed query: (쿼리와 값 생략)").replace(KEY_VALUE, "($1)=(생략)");
}

/** 오류: 이름, 값을 지운 메시지, 스택 위치, 원인 오류를 같은 방식으로 남긴다. */
export function describeError(e: Error, depth = 0): string {
  const message = redactText(e.message).replace(QUOTED, '"…"');
  const frames = (e.stack ?? "")
    .split("\n")
    .filter((l) => /^\s+at /.test(l))
    .slice(0, 12);
  const digest = (e as { digest?: unknown }).digest;
  let out = [`${e.name}: ${message}`, ...frames].join("\n");
  if (typeof digest === "string") out += `\n  digest: ${digest}`;
  const cause = (e as { cause?: unknown }).cause;
  if (cause instanceof Error && depth < 3) out += `\n[cause] ${describeError(cause, depth + 1)}`;
  return out;
}

export function redactLogArg(arg: unknown): unknown {
  if (arg instanceof Error) return describeError(arg);
  if (typeof arg === "string") return redactText(arg);
  return arg;
}

const INSTALLED = Symbol.for("wonbook.logRedaction");

/** console의 error·warn·log·info를 감싼다. 여러 번 불러도 한 번만 감싼다. */
export function installLogRedaction(target: Console = console): void {
  const t = target as Console & { [INSTALLED]?: boolean };
  if (t[INSTALLED]) return;
  t[INSTALLED] = true;
  for (const method of ["error", "warn", "log", "info"] as const) {
    const original = t[method].bind(t);
    t[method] = (...args: unknown[]) => original(...args.map(redactLogArg));
  }
}
