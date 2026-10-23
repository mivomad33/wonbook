// 명령이 다룰 원격 DB(4.8-2). 기본은 개발 DB(Neon dev 브랜치)이고, --prod면 운영, --test면 테스트 브랜치다.
// AI가 명령을 잘못 실행해도 운영 데이터가 바뀌지 않게 운영은 옵션을 줘야만 고른다.
import { backupDb } from "./backup";

export type TargetKey = "prod" | "dev" | "test";

export interface Target {
  key: TargetKey;
  name: "운영" | "개발" | "테스트";
  /** 풀링하지 않는 주소(마이그레이션, 덤프, 긴 작업) */
  url: string;
}

const TARGETS: Record<TargetKey, { name: Target["name"]; env: string }> = {
  prod: { name: "운영", env: "PROD_DATABASE_URL_UNPOOLED" },
  dev: { name: "개발", env: "DATABASE_URL_UNPOOLED" },
  test: { name: "테스트", env: "TEST_DATABASE_URL_UNPOOLED" },
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다(.env.local)`);
  return v;
}

export function targetKey(argv = process.argv): TargetKey {
  const prod = argv.includes("--prod");
  const test = argv.includes("--test");
  if (prod && test) throw new Error("--prod와 --test를 함께 줄 수 없습니다");
  return prod ? "prod" : test ? "test" : "dev";
}

/** 대상 DB를 고르고, 어느 DB인지 출력한다. */
export function target(argv = process.argv): Target {
  const key = targetKey(argv);
  const t = { key, name: TARGETS[key].name, url: need(TARGETS[key].env) };
  console.log(`대상 DB: ${t.name}(${key})`);
  return t;
}

/** 운영 DB를 바꾸기 전에 자동으로 백업한다(4.8-4). 개발·테스트 DB는 시드로 다시 채울 수 있어 백업하지 않는다. */
export async function backupBeforeChange(t: Target): Promise<void> {
  if (t.key !== "prod") return;
  const b = await backupDb(t);
  console.log(`바꾸기 전 백업: ${b}`);
}
