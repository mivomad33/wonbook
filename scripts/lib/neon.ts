// Neon API(개인 API 키 NEON_API_KEY)로 브랜치를 다룬다. 테스트 DB와 임시 브랜치 준비에 쓴다.
// - 새 브랜치는 test 브랜치에서만 분기한다. production에는 실제 데이터가 있고, dev에 자식 브랜치가 있으면 되돌리기가 막힌다.
// - 부모에서 다시 초기화(reset from parent)·복원 함수는 두지 않는다. dev·test의 부모가 production이라 운영 데이터가 복사된다.
// - production·dev·test 브랜치는 지우지 않는다. 지우는 것은 임시로 만든 브랜치뿐이다.
const API = "https://console.neon.tech/api/v2";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}이 없습니다(.env.local)`);
  return v;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/projects/${env("NEON_PROJECT_ID")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env("NEON_API_KEY")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Neon API ${method} ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface Branch {
  id: string;
  name: string;
  parent_id?: string;
}

/** 지우면 안 되는 브랜치 id(운영·개발·테스트) */
function protectedIds(): string[] {
  return [env("NEON_PROD_BRANCH_ID"), env("NEON_DEV_BRANCH_ID"), env("NEON_TEST_BRANCH_ID")];
}

export async function listBranches(): Promise<Branch[]> {
  return (await call<{ branches: Branch[] }>("GET", "/branches")).branches;
}

/** 진행 중인 작업(브랜치 생성 등)이 끝날 때까지 기다린다. */
async function waitOperations(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { operations } = await call<{ operations: { status: string }[] }>("GET", "/operations?limit=20");
    if (!operations.some((o) => ["scheduling", "running"].includes(o.status))) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Neon 작업이 1분 안에 끝나지 않았습니다");
}

/** 이름으로 브랜치를 찾고, 없으면 test 브랜치에서 새로 만든다(읽기·쓰기 엔드포인트 포함). */
export async function ensureBranch(name: string): Promise<Branch> {
  const testId = env("NEON_TEST_BRANCH_ID");
  const found = (await listBranches()).find((b) => b.name === name);
  if (found) {
    if (found.id !== testId && found.parent_id !== testId) throw new Error(`브랜치 ${name}가 test에서 분기한 것이 아닙니다`);
    return found;
  }
  const { branch } = await call<{ branch: Branch }>("POST", "/branches", { branch: { name, parent_id: testId }, endpoints: [{ type: "read_write" }] });
  await waitOperations();
  return branch;
}

/** 브랜치의 접속 주소. pooled면 풀링 주소다. */
export async function connectionUri(branchId: string, pooled = false): Promise<string> {
  const q = new URLSearchParams({ branch_id: branchId, database_name: "neondb", role_name: "neondb_owner", pooled: String(pooled) });
  return (await call<{ uri: string }>("GET", `/connection_uri?${q}`)).uri;
}

/** 임시 브랜치를 지운다. 운영·개발·테스트 브랜치는 거부한다. */
export async function deleteBranch(branchId: string): Promise<void> {
  if (protectedIds().includes(branchId)) throw new Error("production·dev·test 브랜치는 지우지 않습니다");
  await call("DELETE", `/branches/${branchId}`);
  await waitOperations();
}
