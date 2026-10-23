// 실제 샘플 확인(upload-samples.spec.ts)이 쓸 기준값을 표준 출력(JSON)으로 낸다. 파일로 남기지 않는다.
// - ids: 내 계좌 식별값(하이픈·공백 없음) - parsed: Node에서 같은 파서로 읽은 결과(가리기·해시 전)
// Playwright는 이 저장소의 ESM 스크립트를 바로 불러오지 못해 tsx로 따로 돌린다.
import fs from "node:fs";
import path from "node:path";
import { loadAccountIds, parseEnv } from "../../scripts/checks/basis";
import { parseFile } from "../../src/lib/parsers";

async function main() {
  const dir = process.argv[2];
  const password = parseEnv(fs.readFileSync(".env.local", "utf8")).find((e) => e.name === "KAKAOBANK_FILE_PASSWORD")?.value;
  const parsed = [];
  for (const name of fs.readdirSync(dir).filter((f) => /\.(xls|xlsx)$/i.test(f))) {
    parsed.push({ name, parsed: await parseFile(new Uint8Array(fs.readFileSync(path.join(dir, name))), { password }) });
  }
  process.stdout.write(JSON.stringify({ ids: loadAccountIds(), parsed }));
}

main();
