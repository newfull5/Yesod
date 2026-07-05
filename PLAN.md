# Yesod — 초경량 셀프호스팅 이슈 트래커 기획서

> Yesod(יסוד, "기초"): 홈서버(램 4GB 이하)에서 돌아가는 1인용 Jira 대체재.
> 컨테이너 1개, SQLite 1파일, 유휴 메모리 100MB 이하 목표.

## 1. 배경과 목표

기존 셀프호스팅 도구는 전부 과함 — Plane/YouTrack은 램 4GB+, Redmine도 500MB~1GB.
실제로 필요한 건 딱 세 가지:

1. **드래그앤드롭 칸반보드** — 티켓을 Todo → In Progress → Done으로 끌어서 이동
2. **Jira 수준의 이슈 메타데이터** — 캡처한 Jira 이슈 화면의 필드를 그대로 재현
3. **Claude Code 연동(MCP)** — "내 티켓 보여줘 / 티켓 만들어줘"가 바로 동작

### 비목표 (안 만드는 것)

- 알림, 이메일, 웹훅
- 워크플로우 커스터마이징 (상태 전이 규칙 등)
- 권한/멀티테넌시/조직 관리 — 단일 사용자 전제
- 실시간 협업 (동시 편집, presence)
- 검색엔진급 필터/JQL — SQL `LIKE` + 기본 필터로 충분
- Jira 통합 패널류 (Rovo/에이전트, 개발 정보, 자동화)

## 2. 기술 스택

| 레이어 | 선택 | 이유 |
|---|---|---|
| 백엔드 | Go 1.22+ `net/http` (stdlib 라우팅) | 단일 바이너리, 유휴 수십 MB. 외부 라우터 불필요 |
| DB | SQLite + `modernc.org/sqlite` | CGO-free → 정적 빌드, scratch 이미지 가능 |
| 프론트 | React + Vite + dnd-kit | 부드러운 칸반 DnD의 사실상 표준 |
| 서빙 | Go `embed.FS`에 프론트 빌드 내장 | nginx 불필요, 프로세스 1개 |
| 인증 | 없음(기본) / `YESOD_PASSWORD` 환경변수 설정 시 세션 쿠키 로그인 | 홈서버 내부망 전제, 옵션만 열어둠 |
| MCP | Node + `@modelcontextprotocol/sdk`, `/mcp` 디렉터리 | REST API 위 얇은 래퍼 |
| 배포 | Dockerfile 멀티스테이지 → 컨테이너 1개 | SQLite 파일은 볼륨 마운트 |

## 3. 데이터 모델 (SQLite)

Jira 이슈 화면의 메타를 그대로 매핑. 하위 작업은 별도 테이블 없이 `issues.parent_id`.

```sql
projects      (id, key_prefix TEXT UNIQUE,      -- 예: "YS" → 이슈 키 "YS-1"
               name, next_issue_num INTEGER DEFAULT 1)

issue_types   (id, name, icon)                  -- Story / Bug / Task / Epic (시드)

statuses      (id, project_id, name,
               category TEXT CHECK(category IN ('todo','in_progress','done')),
               board_order INTEGER)             -- 보드 컬럼 = 이 테이블의 행

people        (id, name, avatar_color)         -- 로그인 계정 아님, 담당자/보고자 선택용

teams         (id, name)

sprints       (id, project_id, name,
               start_date, end_date,
               state TEXT CHECK(state IN ('future','active','closed')))

issues        (id, project_id, key TEXT UNIQUE, -- "YS-42"
               title, description,              -- description은 markdown
               type_id, status_id,
               reporter_id, assignee_id,        -- → people
               parent_id,                       -- 상위 항목 / 하위 작업 (self FK)
               team_id,
               start_date, due_date,
               board_order REAL,                -- 컬럼 내 카드 순서
               created_at, updated_at)

issue_sprints (issue_id, sprint_id)             -- 다대다: "Sprint +4" 대응

issue_links   (issue_id, linked_issue_id,
               link_type TEXT)                  -- blocks / is blocked by / relates to

comments      (id, issue_id, author_id, body, created_at)  -- "활동" 섹션
```

- 이슈 키 채번: `projects.next_issue_num`을 트랜잭션 안에서 증가시켜 `YS-{n}` 생성. 삭제해도 번호 재사용 없음(Jira와 동일).
- `board_order`는 REAL — 드롭 시 앞뒤 카드의 중간값으로 삽입, 전체 재정렬 없음.
  <!-- ponytail: 부동소수점 정밀도 소진 시 컬럼 단위 재인덱싱 엔드포인트 하나면 됨 -->
- 마이그레이션: `schema.sql` + `PRAGMA user_version`. 마이그레이션 프레임워크 불필요.

## 4. REST API

Base: `/api`, JSON. 인증 활성화 시 세션 쿠키 검사 미들웨어 하나.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST | `/projects` | 프로젝트 목록/생성 |
| GET | `/board?project_id=` | status별 그룹핑된 이슈 (보드 뷰 단일 호출) |
| GET/POST | `/issues?project_id=&status=&assignee=&sprint=&type=&q=` | 목록(필터) / 생성 |
| GET/PATCH/DELETE | `/issues/{key}` | 상세 / 부분수정 / 삭제 (키로 접근: `YS-42`) |
| PATCH | `/issues/{key}/position` | DnD 드롭 시: `{status_id, after_key?}` → status+board_order 갱신 |
| POST/DELETE | `/issues/{key}/links` | 연결된 업무 항목 |
| GET/POST | `/issues/{key}/comments` | 활동(댓글) |
| GET/POST/PATCH | `/sprints?project_id=` | 스프린트 (state 전환 포함) |
| GET/POST | `/people`, `/teams`, `/statuses?project_id=` | 선택지 관리 |

- `PATCH /issues/{key}`는 보낸 필드만 갱신 (assignee_id, due_date, description 등 전부 이 하나로).
- 에러: `{"error": "메시지"}` + 적절한 상태코드. 그 이상 없음.

## 5. 화면 기획

SPA 화면 2개 + 모달 1개.

### 5.1 보드 뷰 (`/`)

```
[Yesod ▾프로젝트] [스프린트 ▾] [담당자 ▾] [유형 ▾] [검색____]   [+ 이슈 만들기]
┌─ 해야 할 일 (3) ──┐ ┌─ 진행 중 (2) ─────┐ ┌─ 완료 (5) ────────┐
│ ▣ YS-12          │ │ ▣ YS-9           │ │ ▣ YS-3           │
│ 카드 제목         │ │ ...              │ │ ...              │
│ 🏷Story 👤 ⏱기한  │ │                  │ │                  │
│ [+ 만들기]        │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

- 컬럼 = `statuses` 테이블, 카드 = 이슈. dnd-kit으로 컬럼 간/내 드래그.
- 드롭 즉시 낙관적 UI 갱신 → `PATCH /position` 호출, 실패 시 롤백.
- 카드: 키, 제목, 유형 아이콘, 담당자 아바타(이니셜+색), 기한(임박 시 빨강).
- 상단 필터는 클라이언트 사이드 (단일 사용자, 이슈 수백 건 규모 전제).

### 5.2 이슈 상세 모달 (카드 클릭)

캡처한 Jira 레이아웃 그대로 2컬럼:

**좌측 (본문)**
- 브레드크럼: `상위항목 키 / YS-42`
- 제목 (인라인 편집)
- 설명 (markdown, 클릭 → textarea 편집)
- **하위 작업**: parent_id가 이 이슈인 목록 + 인라인 추가
- **연결된 업무 항목**: link_type별 그룹 + 추가/삭제
- **활동**: 댓글 목록 + 입력창

**우측 (메타 패널)**
- 상태 드롭다운 (컬럼 이동과 동일 효과)
- 보고자 / 담당자 (+ "나에게 할당" 버튼 — `YESOD_ME` 환경변수로 지정된 person)
- 스프린트 (다중 선택, "Sprint +4" 스타일 표시)
- 상위 항목 (이슈 검색 선택)
- 시작일 / 기한 (`<input type="date">`)
- Team 드롭다운
- 생성일/수정일 (읽기 전용)

### 5.3 백로그 뷰 (`/backlog`)

- 스프린트별 섹션 + 백로그 섹션의 리스트 뷰. 행 드래그로 스프린트 배정.
- v1에서는 보드 다음 순위 — 보드+모달 완성 후 착수.

## 6. MCP 서버 (`/mcp`)

REST API를 감싸는 stdio MCP 서버. `claude mcp add yesod -- node /path/to/mcp/index.js`.

| 툴 | 매핑 |
|---|---|
| `list_issues` | GET /issues (필터 인자 전달) |
| `get_issue` | GET /issues/{key} |
| `create_issue` | POST /issues |
| `update_issue` | PATCH /issues/{key} (상태 변경 포함) |
| `assign_to_me` | PATCH /issues/{key} `{assignee_id: me}` |
| `add_comment` | POST /issues/{key}/comments |
| `list_sprints` | GET /sprints |

- 환경변수: `YESOD_URL`, `YESOD_PASSWORD`(옵션), `YESOD_ME`(옵션).
- 각 툴 description에 필드 의미를 충분히 적어 Claude가 스키마 안 물어보게.

## 7. 저장소 구조

```
Yesod/
├── main.go              # 서버 엔트리 + 라우팅
├── internal/
│   ├── db/              # schema.sql, 쿼리 함수
│   └── api/             # 핸들러
├── web/                 # Vite + React (빌드 → embed)
│   └── src/
├── mcp/                 # Node MCP 서버
├── Dockerfile           # 3-stage: web 빌드 → go 빌드 → scratch
├── docker-compose.yml   # 서비스 1개, ./data:/data 볼륨
└── PLAN.md              # 이 문서
```

## 8. 진행 순서

| # | 마일스톤 | 완료 기준 |
|---|---|---|
| 1 | 스캐폴딩 | Go 서버 기동 + Vite dev 프록시 + schema.sql 적용 |
| 2 | REST API | curl로 이슈 CRUD/보드/포지션 전부 동작, Go 테스트 통과 |
| 3 | 보드 뷰 | 브라우저에서 카드 생성 + 드래그 이동이 DB에 반영 |
| 4 | 이슈 상세 모달 | 5.2의 전 필드 편집 가능 |
| 5 | MCP 서버 | Claude Code에서 목록/생성/상태변경 동작 |
| 6 | Docker | `docker compose up` 한 방 + 유휴 메모리 측정 |
| 7 | 백로그 뷰 | 스프린트 배정 드래그 동작 |

각 마일스톤 완료 시 커밋. 3번 끝나면 이미 실사용 가능.

## 9. 검증 기준

- [ ] `docker compose up` → 보드 접속 → 카드 생성 → 드래그로 컬럼 이동 → 새로고침 후 유지
- [ ] 상세 모달에서 담당자/스프린트/기한/상위항목 편집이 DB 반영
- [ ] Claude Code: "내 티켓 목록 보여줘" / "버그 티켓 만들어줘" / "YS-3 완료로 바꿔줘" 동작
- [ ] `docker stats` 유휴 메모리 ≤ 100MB
- [ ] SQLite 파일 하나 복사 = 백업 완료
