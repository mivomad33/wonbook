// 서버가 시작할 때 한 번 불린다. 서버 로그에서 사용자 데이터를 지운다(4.7-3, lib/log-redact.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLogRedaction } = await import("@/lib/log-redact");
    installLogRedaction();
  }
}
