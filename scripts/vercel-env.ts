// Vercel Production 환경 변수를 .env.local 값으로 넣는다(4.7-5). 사용: pnpm exec tsx scripts/vercel-env.ts
// 운영용 DB 주소와 키는 Production에만 넣는다(Preview·Development에는 넣지 않는다). 값은 표준 입력으로 넘겨 화면·프로세스 목록에 나오지 않는다.
// 비밀 값은 Sensitive로 저장해 내려받을 수 없게 한다. 저장소 루트의 .vercel/project.json(vercel link)이 있어야 한다.
import "./env";
import { spawnSync } from "node:child_process";
import { ROOT } from "./checks/basis";
import { VERCEL } from "./lib/vercel";

// Vercel 변수 이름 ← .env.local 변수 이름. 앱이 실행 중에 읽는 것만 넣는다(백업 키, Neon API 키는 로컬 명령만 쓴다).
const VARS: [string, string][] = [
  ["DATABASE_URL", "PROD_DATABASE_URL"],
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
  ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
  ["ADMIN_EMAIL", "ADMIN_EMAIL"],
  ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  ["ACCOUNT_HASH_KEY", "ACCOUNT_HASH_KEY"],
  ["PASSWORD_ENCRYPTION_KEY", "PASSWORD_ENCRYPTION_KEY"],
];

for (const [name, from] of VARS) {
  const value = process.env[from];
  if (!value) throw new Error(`${from}이 없습니다(.env.local)`);
  const r = spawnSync("npx", ["--yes", VERCEL, "env", "add", name, "production", "--force", "--sensitive"], {
    cwd: ROOT,
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`${name} 넣기 실패: ${(r.stderr ?? "").split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
  console.log(`✓ ${name}(Production)`);
}
