# 원북(wonbook)

금융사에서 내려받은 거래 내역 파일을 올리면 입력·분류·잔액 보정까지 자동으로 끝나는, 나 혼자 쓰는 로컬 웹 가계부다.
로그인 없이 이 맥에서만 쓰고, 데이터는 SQLite 파일 하나(`data/wonbook.db`)에 있다.

이 문서는 설치하고 쓰는 방법만 다룬다. 기획·설계·진행 상황은 `docs/`(이 저장소에 포함하지 않는 별도 비공개 저장소)에 있다.

## 처음 설정

- Node 24, pnpm을 쓴다.
- `pnpm install` 중에 better-sqlite3의 빌드 스크립트 승인(`pnpm approve-builds`)을 물어도 승인하지 않는다. 패키지에 든 바이너리로 동작하고, 승인하면 설치가 실패한다([0단계 파일](docs/stages/0-preparation.md) 2장).
- `.env.local`(git 제외)에 다음을 넣는다.
  - `ANTHROPIC_API_KEY`: 거래 자동 분류(Claude API)에 쓴다.
  - `KAKAOBANK_FILE_PASSWORD`: 카카오뱅크 거래 내역 파일의 암호
  - 필요하면 `WONBOOK_PORT`(운영 서버 포트, 기본 4848), `WONBOOK_IDLE_MINUTES`(자동 종료까지 분, 기본 30)

```bash
pnpm install
```

```bash
pnpm db:migrate
```

## 매일 쓰기

Dock의 원북 아이콘을 누르면 서버가 꺼져 있을 때만 켜고 기본 브라우저로 http://localhost:4848 을 연다.
서버는 요청이 30분 동안 없으면 스스로 꺼진다. 꺼졌으면 아이콘을 다시 누른다.

아이콘 앱은 처음 한 번 만든다. 만든 뒤 Finder에서 `~/Applications/Wonbook.app`을 Dock으로 끌어다 둔다.

```bash
pnpm make-launcher
```

- 저장소를 옮기거나 node 버전·`WONBOOK_PORT`를 바꾸면 다시 실행한다. 지우려면 앱을 휴지통에 버린다.
- 서버 출력은 `data/server.log`에 쌓인다. 아이콘을 눌렀는데 "서버가 뜨지 않았습니다" 알림이 뜨면 이 파일을 본다.
- 서버는 켤 때 DB 마이그레이션을 적용하므로, 스키마가 바뀐 코드를 받아도 따로 `pnpm db:migrate`를 하지 않아도 된다.
- 터미널에서 같은 서버를 켜려면 `pnpm serve`(먼저 `pnpm build`)를 쓴다.
- 동작 방식과 포트를 고른 이유는 [design.md](docs/design.md) 2.4에 있다.

### 코드를 바꾼 뒤

새 빌드를 만들고, 켜져 있는 서버를 끈다. 다음에 아이콘을 누르면 새 빌드로 뜬다.

```bash
pnpm build
```

```bash
kill $(lsof -tiTCP:4848 -sTCP:LISTEN)
```

다른 브랜치에서 확인용으로 빌드했다면, main으로 돌아와 다시 빌드한다. 운영 서버도 같은 `.next/`를 쓰기 때문이다.

## 데이터와 백업

- 실제 데이터는 `data/wonbook.db` 하나에 있다(git 제외). 이 파일을 잃으면 기록이 모두 사라진다.
- 파일을 올릴 때마다 덮어쓰기 직전 DB가 `data/backups/wonbook/`에 저장되고, 최근 20개가 남는다([3단계 파일](docs/stages/3-file-upload.md) 6장).
- 복원은 서버를 끄고 백업 파일을 `data/wonbook.db`로 복사하면 된다. 디스크 고장에 대비하는 것은 Time Machine 같은 이 앱 밖의 몫이다.

## 개발

- `pnpm dev`: 개발 서버(http://localhost:3000, 앱 DB)
- `pnpm test`: 테스트(Vitest, 메모리 DB를 쓰고 Claude API를 부르지 않는다)
- `pnpm typecheck`, `pnpm lint`
- 스키마를 고치면 `pnpm db:generate`로 마이그레이션을 만들고 `pnpm db:migrate`로 앱 DB에 적용한다. 주의할 점은 [design.md](docs/design.md) 2.3에 있다.

### 확인용 시드 DB

화면 확인에는 앱 DB 대신 시드 DB(`data/dev.db`)를 쓴다. 실제 데이터에 확인용 거래가 섞이지 않게 하기 위해서다([design.md](docs/design.md) 4.5).

```bash
pnpm db:seed
```

- `pnpm dev:seed`: 시드 DB로 개발 서버(http://localhost:3001)
- `pnpm build` 뒤 `pnpm start:seed`: 시드 DB로 빌드한 앱(http://localhost:3011)

포트는 운영 서버 4848, 개발 서버 3000·3001·3010·3011이다. 같은 맥에서 쓰는 senseful(4747)과 겹치지 않는다.
