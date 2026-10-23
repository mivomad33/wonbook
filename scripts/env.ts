// 스크립트에서도 개발 서버처럼 .env*를 읽는다. 다른 import보다 먼저 가져온다.
// @next/env는 next의 의존성이라 pnpm에서는 바로 import할 수 없어 next 패키지 기준으로 찾는다.
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(import.meta.url);
const fromNext = createRequire(req.resolve("next/package.json"));
const { loadEnvConfig } = fromNext("@next/env") as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };

loadEnvConfig(path.resolve(import.meta.dirname, ".."));
