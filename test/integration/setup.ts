// 통합 테스트 공통 준비. Next.js 요청 맥락(쿠키, 경로 다시 그리기, 이동)과 Claude API를 테스트용으로 바꿔 끼운다.
// 서버 동작은 화면과 같은 코드(actionUser → getAppDb)를 그대로 지나고, 세션 확인도 실제 DB에서 한다.
import { vi } from "vitest";
import type { Classifier } from "@/lib/categorize";

type TestGlobals = { testCookies: Map<string, string>; fakeClassifier: Classifier & { calls: number } };
const g = globalThis as unknown as TestGlobals;
g.testCookies = new Map();
const fake = (async (items: Parameters<Classifier>[0]) => {
  fake.calls += 1;
  return new Map(items.map((it) => [it.id, it.direction === "in" ? "기타 수입" : "기타 지출"]));
}) as unknown as TestGlobals["fakeClassifier"];
fake.calls = 0;
g.fakeClassifier = fake;

vi.mock("next/headers", () => {
  const jar = () => (globalThis as unknown as TestGlobals).testCookies;
  return {
    cookies: async () => ({
      get: (name: string) => (jar().has(name) ? { name, value: jar().get(name)! } : undefined),
      has: (name: string) => jar().has(name),
      set: (name: string, value: string) => void jar().set(name, value),
      delete: (name: string) => void jar().delete(name),
    }),
  };
});
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));
vi.mock("@/lib/categorize/claude", async (orig) => ({
  ...(await orig<object>()),
  classifierFromEnv: () => (globalThis as unknown as TestGlobals).fakeClassifier,
}));

export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
