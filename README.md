# Wonbook

금융사에서 내려받은 거래 내역 파일을 올리면 입력, 분류, 잔액 맞추기까지 알아서 끝나는 웹 가계부입니다.

- 운영 주소: https://wonbook.vercel.app (로그인 없이 데모를 볼 수 있습니다)
- 지금은 하나은행, 국민은행, 카카오뱅크, 하나카드, 국민카드, 한국투자증권(일반·ISA) 파일을 읽습니다. 다른 금융사 계좌는 수동 계정으로 씁니다.

## 무엇을 하는 앱인가

- 금융사 파일(xls, xlsx, html, 암호 걸린 xlsx)을 **브라우저에서** 읽고, 읽은 거래만 서버로 보냅니다. 원본 파일은 서버로 가지 않습니다.
- 같은 기간을 다시 올리면 그 기간을 덮어쓰고, 직접 손댄 거래는 지우기 전에 확인합니다. 마지막 업로드는 되돌릴 수 있습니다.
- 파일의 거래 후 잔액과 계산한 잔액이 다르면 보정 거래를 자동으로 넣습니다.
- 거래 내용으로 카테고리를 자동 분류합니다(Claude API). 한 번 고친 분류는 같은 가맹점에 다시 씁니다.
- 자산 현황, 월별 수입/지출, 거래 목록, 계정·카테고리 관리, 거래 CSV 내보내기, 탈퇴를 제공합니다.
- 개인정보: 계좌번호는 서버 키로 만든 해시와 끝 4자리만 저장하고, 거래 내용에 든 긴 계좌번호는 가립니다. 카카오뱅크 파일 암호는 암호화해 저장합니다.

기술 스택

- Next.js 16(App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4, shadcn/ui(Base UI)
- Postgres(Neon) + Drizzle ORM, 구글 로그인(OAuth + PKCE, 직접 구현)
- Claude API(자동 분류), SheetJS·cheerio·officecrypto-tool(파일 읽기)
- Vercel(호스팅, Web Analytics), Vitest·PGlite(단위), Neon 테스트 브랜치(통합), Playwright(E2E), GitHub Actions(CI)

## 처음 설정

- Node 24(`.nvmrc`), pnpm을 씁니다.
- `pnpm install` 중에 better-sqlite3의 빌드 스크립트 승인(`pnpm approve-builds`)을 물어도 승인하지 않습니다. 패키지에 든 바이너리로 동작하고, 승인하면 설치가 실패합니다. better-sqlite3는 예전 로컬 DB를 옮기는 명령과 검사 명령에서만 씁니다.
- Postgres 클라이언트 18(`pg_dump`, `pg_restore`)이 필요합니다(`brew install postgresql@18`).
- `.env.example`을 `.env.local`로 복사해 값을 채웁니다. `.env.local`은 git과 배포에서 빠집니다.

```bash
pnpm install
```

### 환경 변수

이름만 적습니다. 값은 `.env.local`과 Vercel Production 환경 변수에만 둡니다.

- DB: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`(개발), `TEST_DATABASE_URL`, `TEST_DATABASE_URL_UNPOOLED`(테스트), `PROD_DATABASE_URL`, `PROD_DATABASE_URL_UNPOOLED`(운영)
- Neon API(테스트 브랜치·임시 브랜치): `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PROD_BRANCH_ID`, `NEON_DEV_BRANCH_ID`, `NEON_TEST_BRANCH_ID`
- 구글 로그인: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- 관리자: `ADMIN_EMAIL`
- 서버 키(무작위 32바이트, base64): `ACCOUNT_HASH_KEY`(계좌 해시), `PASSWORD_ENCRYPTION_KEY`(카카오뱅크 암호), `BACKUP_ENCRYPTION_KEY`(백업). 잃으면 백업을 풀 수 없고 계좌를 맞출 수 없으므로 맥 밖에도 따로 보관합니다.
- 자동 분류: `ANTHROPIC_API_KEY`. 한도는 `CLASSIFY_USER_DAILY_LIMIT`(기본 500), `CLASSIFY_TOTAL_DAILY_LIMIT`(기본 3000)로 바꿀 수 있습니다.
- 실제 샘플 확인용: `KAKAOBANK_FILE_PASSWORD`

비밀 값 변수 이름에는 `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `DATABASE_URL` 중 하나를 넣습니다(공개 저장소 검사가 이 이름의 값을 찾습니다).

## 개발

DB 명령의 기본 대상은 **개발 DB**(Neon `dev` 브랜치)입니다. 운영 DB는 `--prod`를 줘야만 고릅니다.

```bash
pnpm db:dev-reset
```

개발 DB를 비우고 마이그레이션을 처음부터 적용한 뒤 테스트 사용자(user1, user2)를 만들고 user1에 시드 데이터를 넣습니다.

```bash
pnpm dev
```

http://localhost:3000 에서 엽니다(구글 로그인 콜백 주소가 이 주소입니다). 개발 서버에만 있는 기능:

- 테스트 로그인: `/api/auth/dev-login?as=admin`, `?as=user1`, `?as=user2` 등. 구글 없이 그 사용자로 들어갑니다. 빌드 결과물에는 이 경로가 없습니다.
- 화면 아래의 "개발 DB" 표시
- `WONBOOK_FAKE_CLASSIFIER=1`로 켜면 Claude API 대신 가짜 분류를 씁니다.

실제 샘플 파일(`samples/`, git 제외)은 개발 DB에만 올립니다. 카카오뱅크 샘플 암호는 화면에 치지 않고 다음 명령으로 user2에 저장해 둡니다(값은 출력하지 않습니다).

```bash
pnpm exec tsx scripts/dev-kakao-password.ts
```

## 테스트

```bash
pnpm test
```

단위 테스트입니다. DB가 필요한 테스트는 프로세스 안 Postgres(PGlite)로 돌아 외부 DB가 필요 없습니다.

```bash
pnpm test:integration
```

통합 테스트입니다. 서버 동작의 권한·사용자 분리·업로드 상한·분류 한도 동시 요청·탈퇴를 실제 Postgres(Neon `test` 브랜치)에서 확인합니다. 시작할 때 `test` 브랜치의 스키마를 지우고 다시 만듭니다. 필요한 변수: `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_TEST_BRANCH_ID`(와 운영·개발 브랜치 id).

```bash
pnpm test:e2e
```

E2E 테스트(Playwright, 데스크톱·375px)입니다. `test` 브랜치를 쓰는 개발 서버를 3100 포트에 따로 띄웁니다. 통합 테스트와 같은 브랜치를 쓰므로 동시에 돌리지 않습니다. 스크린샷은 저장소 밖에 둡니다. 처음 한 번 `pnpm exec playwright install chromium`이 필요합니다.

```bash
pnpm exec playwright test -c playwright.samples.config.ts
```

실제 샘플 확인입니다(`samples/`가 있을 때만). `pnpm dev`를 띄운 뒤 실제 샘플을 브라우저에서 읽어 올리고, 서버로 간 요청에 원본 파일과 계좌 식별값이 없는지, 브라우저와 Node의 읽은 결과가 같은지 봅니다.

```bash
pnpm verify
```

타입 검사, 린트, 단위 테스트, 빌드를 차례로 돌립니다. push 전 검사와 CI가 같은 명령을 씁니다.

## DB 스키마 바꾸기

1. `src/db/schema.ts`를 고칩니다.
2. 마이그레이션 파일을 만듭니다.

```bash
pnpm db:generate
```

3. 개발 DB에 적용해 확인합니다.

```bash
pnpm db:migrate
```

4. 배포 전에 운영 DB에 적용합니다. 적용 전에 자동으로 암호화 백업을 받습니다.

```bash
pnpm db:migrate --prod
```

## 백업과 복원

```bash
pnpm db:backup --prod
```

운영 DB를 `pg_dump`로 받아 바로 암호화(AES-256-GCM, 키 `BACKUP_ENCRYPTION_KEY`)해 `data/backups/prod-날짜-시각.dump.enc`로 씁니다. 평문 덤프는 디스크에 남지 않습니다. 대상마다 최근 10개만 남깁니다. 운영 DB를 바꾸는 명령(마이그레이션, 데이터 이전)은 실행 전에 자동으로 백업합니다.

복원은 풀어서 바로 `pg_restore`로 넘깁니다. 키가 틀리거나 파일이 손상됐으면 아무것도 내보내지 않고 실패합니다.

```bash
pnpm -s db:backup-decrypt data/backups/prod-20261023-120000.dump.enc | pg_restore -l
```

```bash
pnpm -s db:backup-decrypt data/backups/prod-20261023-120000.dump.enc | pg_restore --clean --if-exists --no-owner --no-privileges -d "복원할 DB 주소"
```

백업에 개인정보 검사(평문 검색, 틀린 키, 계좌 식별값)를 하려면 다음을 씁니다.

```bash
pnpm check:db --backup data/backups/prod-20261023-120000.dump.enc
```

## 예전 로컬 DB 옮기기

예전 로컬 앱의 SQLite DB(`data/wonbook.db`)를 운영 DB의 관리자 계정으로 옮기는 명령입니다. 계좌번호는 해시와 끝 4자리로 바꾸고, 거래 내용·메모·파일 이름의 계좌번호는 가리고, 거래 원본 행은 옮기지 않습니다. 이미 관리자 데이터가 있으면 아무것도 바꾸지 않습니다. 옮긴 뒤 자산 현황·최근 세 달 월별·계정별 거래 수를 로컬 DB로 계산한 값과 견줍니다.

```bash
pnpm db:import-rehearsal
```

`test` 브랜치에서 임시 브랜치를 만들어 옮겨 보고, 확인한 뒤 그 브랜치를 지웁니다.

```bash
pnpm db:import-local --prod
```

운영 DB로 옮깁니다. 실제 로컬 DB는 운영으로만 옮기며, 개발·테스트 DB에는 `--from <가짜 SQLite 파일>`로만 씁니다.

## 관리자

`ADMIN_EMAIL`과 같은 이메일의 구글 계정이 관리자입니다. 사이드바에 관리자 화면이 생기고, 가입자 수와 오늘 분류 사용량만 봅니다. 관리자는 분류 한도에서 빠집니다.

예전 로컬 DB를 옮기면 관리자 계정이 구글 계정 없이 미리 만들어집니다. 운영 주소에서 그 이메일로 처음 구글 로그인하면 새 계정을 만들지 않고 그 계정에 연결됩니다.

## 배포

Vercel 프로젝트 `wonbook`(함수 리전 `sin1`)에 로컬 명령으로만 배포합니다. Git 연동은 쓰지 않습니다. Vercel CLI는 `npx --yes vercel@65.1.0`으로 씁니다(`vercel env pull`처럼 `.env.local`을 덮어쓰는 명령은 쓰지 않습니다).

처음 한 번 준비합니다.

- 프로젝트 연결: `vercel link`는 연결한 폴더의 `.env.local`을 만들거나 덮어쓰므로, 빈 임시 폴더에서 `npx --yes vercel@65.1.0 link --yes --project wonbook`을 실행한 뒤 그 폴더의 `.vercel/project.json`만 저장소 루트의 `.vercel/`로 옮깁니다.
- 환경 변수: 다음 명령이 `.env.local` 값을 Vercel **Production**에만 Sensitive로 넣습니다(`DATABASE_URL`은 `PROD_DATABASE_URL` 값). 값은 표준 입력으로 넘겨 출력하지 않습니다.

```bash
pnpm exec tsx scripts/vercel-env.ts
```

- 사용 분석 켜기(첫 운영 배포 전에): `npx --yes vercel@65.1.0 project web-analytics enable wonbook`

배포는 다음 명령 하나로 합니다.

```bash
pnpm release
```

순서: `verify` → 커밋된 파일만 작업 폴더 밖 임시 폴더로 꺼내기 → `vercel build`(Production) → 배포 결과물 검사(`check:output`) → `vercel deploy --prebuilt --prod` → 배포 뒤 점검(`smoke`). 앞 단계가 실패하면 멈추고, 커밋하지 않은 변경이 있으면 배포하지 않습니다.

- 배포 결과물 검사: 결과물에 비공개 파일, 금지 문자열, 비밀 값, 계좌 식별값, 테스트 로그인 경로가 없고, 소개 화면·처리방침의 메타 태그, 아이콘, `robots.txt`, `sitemap.xml`이 맞는지 봅니다.
- 배포 뒤 점검은 따로 돌릴 수도 있습니다(상태를 바꾸는 요청은 하지 않습니다).

```bash
pnpm smoke https://wonbook.vercel.app
```

- 사용 분석(Vercel Web Analytics)의 수집 경로 `/_vercel/insights/*`는 prebuilt 배포에서 붙지 않을 수 있습니다. 배포 뒤 점검에서 분석 스크립트만 실패하면, Analytics가 켜져 있는지 확인하고 한 번 다시 배포합니다. 그래도 안 되면 원격 빌드로 배포합니다. 로컬 빌드와 결과물 검사를 똑같이 통과한 뒤, 같은 커밋을 꺼낸 깨끗한 임시 폴더를 Vercel에서 빌드합니다.

```bash
pnpm release --remote-build
```

- 점검이 실패하면 원인을 고쳐 다시 배포합니다. 운영 데이터와 상관없는 문제면 Vercel 대시보드나 `vercel rollback`으로 이전 배포로 되돌릴 수 있습니다.

### 운영 중 오류 보기

오류는 Vercel 함수 로그에서 봅니다(대시보드 → 프로젝트 → Logs). 별도 오류 알림은 두지 않습니다. 로그에는 오류 종류와 위치만 남기고 거래 내용·금액·계좌번호·이메일·비밀 값은 남기지 않습니다.

```bash
npx --yes vercel@65.1.0 logs --project wonbook --environment production --since 1h
```

## push 전 검사와 CI

`pnpm install`이 git 훅 폴더를 `.githooks`로 설정합니다. push할 때마다 `pnpm verify`와 공개 저장소 검사(`pnpm check:repo`)를 돌리고, 실패하면 push를 막습니다. 공개 저장소 검사는 모든 커밋·커밋 메시지·브랜치 이름에서 비공개 파일, 금지 문자열, 비밀 값을 찾습니다. 검사 기준은 저장소 밖의 비공개 목록과 `.env.local`에서 읽습니다. 훅을 건너뛰지 않습니다.

GitHub Actions(CI)는 모든 브랜치 push와 PR에서 "검사"(타입 검사·린트·단위 테스트)와 "빌드"를 돌립니다. 배포는 하지 않습니다.
