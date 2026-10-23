// 데모를 둘러보는 동안 Claude API를 부르지 않는다(4.5-3).
// API는 classifierFromEnv로만 만들고, 그것을 부르는 곳은 서버 동작("use server" 파일)뿐이다.
// 서버 동작은 API를 만들기 전에 actionUser()로 데모를 거부한다(통합 테스트 test/integration/auth.test.ts가 동작마다 확인).
// 화면(페이지·레이아웃·컴포넌트)은 API를 부르지 않으므로, 데모 화면을 열어도 API 요청이 없다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("Claude API를 부르는 곳(4.5-3)", () => {
  it("API를 만드는 함수는 서버 동작에서만 부르고, 그 전에 actionUser()로 데모를 거부한다", () => {
    const callers = files(SRC).filter((f) => /\b(classifierFromEnv|createClaudeClassifier)\(/.test(fs.readFileSync(f, "utf8")) && !f.endsWith(path.join("categorize", "claude.ts")));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      const text = fs.readFileSync(f, "utf8");
      expect(text.startsWith('"use server"'), path.relative(SRC, f)).toBe(true);
      // 함수마다 actionUser()가 API를 만들기 전에 있다
      for (const fn of text.split(/\nexport async function /).slice(1)) {
        const call = fn.search(/\bclassifierFromEnv\(/);
        if (call < 0) continue;
        const guard = fn.search(/\bactionUser\(\)/);
        expect(guard >= 0 && guard < call, `${path.relative(SRC, f)}: ${fn.slice(0, 40)}`).toBe(true);
      }
    }
  });
});
