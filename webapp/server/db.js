// SQLite 초기화 + 스키마. better-sqlite3 = 동기 API라 로컬 개인용에 깔끔.
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data/app.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── 스키마 ──────────────────────────────────────────────
// snapshots : 한 번의 수집 실행 (소스·지역·해시태그셋·시각)
// reels     : 수집된 개별 릴스 (구매의도=댓글 등 지표 + 점수)
// products  : 릴스를 묶은 제품 (아마존 ASIN·상태 게이트)
// product_reels : 제품 ↔ 릴스 N:M 연결
// 떡상(velocity)은 후순위 — reels.snapshot_id 로 시점 비교 여지만 남겨둠.
db.exec(`
CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  source     TEXT    NOT NULL DEFAULT 'ig',
  region     TEXT    NOT NULL DEFAULT 'us',
  network    TEXT    NOT NULL DEFAULT 'amazon',
  tag_set    TEXT,            -- JSON 배열 문자열
  note       TEXT,
  reel_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id  INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,           -- IG shortcode
  url          TEXT,
  username     TEXT,
  followers    INTEGER,
  play         INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  comments     INTEGER NOT NULL DEFAULT 0,
  taken_at     TEXT,
  is_paid      INTEGER NOT NULL DEFAULT 0,
  caption      TEXT,
  tag          TEXT,                       -- 어느 해시태그에서 잡혔나
  score        REAL    NOT NULL DEFAULT 0,
  raw          TEXT,                       -- 원본 JSON (디버그용)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reels_snapshot ON reels(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_reels_code ON reels(code);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category    TEXT,
  asin        TEXT,
  amazon_url  TEXT,
  image_url   TEXT,
  status      TEXT    NOT NULL DEFAULT 'candidate', -- candidate|verified|rejected|produced
  total_comments INTEGER NOT NULL DEFAULT 0,        -- 묶인 릴스 댓글 합(구매의도)
  reel_count  INTEGER NOT NULL DEFAULT 0,
  score       REAL    NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_reels (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reel_id    INTEGER NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, reel_id)
);
`)

// ── 마이그레이션: 컬럼 추가(있으면 스킵) ──
function ensureColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}
// Step 4 아마존 검증 게이트용 필드
ensureColumn('products', 'price', 'TEXT')
ensureColumn('products', 'rating', 'REAL')
ensureColumn('products', 'review_count', 'TEXT')
ensureColumn('products', 'verified_at', 'TEXT')
// 릴스우선 모델: 영어 아마존 검색어 저장 (제품 식별 단계에서 생성)
ensureColumn('products', 'search_query', 'TEXT')
// 릴스 썸네일 (수집 시 IG에서 캡처) — 비주얼 그리드용
ensureColumn('reels', 'thumbnail', 'TEXT')
// 릴스 영상 분석 결과(JSON) — 훅/구조/씬스크립트/에셋
ensureColumn('products', 'analysis', 'TEXT')
ensureColumn('products', 'analyzed_at', 'TEXT')
// 아마존 제품이 릴스 원본인지(original) 동급 대체품인지(related)
ensureColumn('products', 'match_type', 'TEXT')

// 콘텐츠 카드 — 제작 대상(product) 1개에서 N개. 씬별 스크립트·이미지·영상·VO 저장.
db.exec(`
CREATE TABLE IF NOT EXISTS contents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  title      TEXT,
  scenes     TEXT,           -- JSON 배열: 씬별 {자막,VO,샷,이미지프롬프트,길이,makeVideo,image,video,vo}
  voice      TEXT,
  bgm        TEXT,
  export     TEXT,           -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contents_product ON contents(product_id);

-- 후보 제품: 제작 대상(테마) 1개에 원본+동급 N개. 콘텐츠가 그중 하나를 적용.
CREATE TABLE IF NOT EXISTS candidates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER REFERENCES products(id) ON DELETE CASCADE,
  asin         TEXT,
  title        TEXT,
  price        TEXT,
  rating       REAL,
  review_count TEXT,
  image_url    TEXT,
  amazon_url   TEXT,
  match_type   TEXT,            -- original | related
  is_primary   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidates_product ON candidates(product_id);
`)
// 콘텐츠가 적용한 후보 제품 (구모델)
ensureColumn('contents', 'candidate_id', 'INTEGER')

// ── 신모델: 분석을 독립 자산으로, 콘텐츠 = 분석 × 제품 ──
// 릴스 분석(재사용 가능한 구조 템플릿). 릴스 스냅샷을 함께 담아 릴스 수명과 분리.
db.exec(`
CREATE TABLE IF NOT EXISTS analyses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT,
  category      TEXT,
  reel_code     TEXT,
  reel_url      TEXT,
  reel_thumbnail TEXT,
  reel_username TEXT,
  reel_caption  TEXT,
  reel_comments INTEGER,
  reel_play     INTEGER,
  analysis      TEXT,           -- JSON: 훅/구조/씬/에셋
  analyzed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
// 분석 단계에서 비전으로 매칭한 제품 (생김새 기준) + 후보 + 매칭 메타 — ③/④가 재사용
ensureColumn('analyses', 'product', 'TEXT')          // JSON: 비전 매칭된 원본 제품 (링크 포함) | null
ensureColumn('analyses', 'candidates', 'TEXT')       // JSON: 아마존 후보 목록 (교체용)
ensureColumn('analyses', 'match_meta', 'TEXT')       // JSON: {asin,confidence,reason,query}

// 콘텐츠 = 분석 1개 + 제품 1개(콘텐츠 안에서 선택)
ensureColumn('contents', 'analysis_id', 'INTEGER')
ensureColumn('contents', 'product', 'TEXT') // JSON: {asin,title,price,rating,reviewCount,image,amazon_url}
ensureColumn('contents', 'overall', 'TEXT')          // JSON: 전체 스크립트 {angle,title,hookLine,beats,vo,cta,durationSec}
ensureColumn('contents', 'final_form', "TEXT DEFAULT 'card'") // 'card'(이미지) | 'movie'(클립)
ensureColumn('contents', 'style', 'TEXT')            // 전 씬 공통 이미지 스타일/지시 (예: "여성 손, 한국 가정집, 밝은 자연광")
ensureColumn('contents', 'preview', 'TEXT')          // ffmpeg 임시 프리뷰 무비 경로 (/output/...)
ensureColumn('contents', 'direction', 'TEXT')        // 연출 지시 (훅·샷 스타일) — 스크립트 생성에 항상 반영
ensureColumn('contents', 'persona', 'TEXT')          // VO 화자 페르소나 (playbook personas.yaml 키 또는 자유텍스트)
ensureColumn('contents', 'hook', 'TEXT')             // 훅/스토리텔링 셰이프 (playbook hooks.yaml 키)
ensureColumn('contents', 'shot_count', 'INTEGER')    // 씬(샷) 목표 개수 (null = 자동 5~8)
ensureColumn('contents', 'export_mp4', 'TEXT')       // Remotion 정식 익스포트 mp4 경로
ensureColumn('contents', 'character_ref', 'TEXT')    // 캐릭터(인물) 레퍼런스 — 모든 씬 이미지에 동일 인물 적용 (url 또는 hfmedia:)

// 앱 전역 설정 (key-value) — 예: 생성 언어/지역
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`)
export function getSetting(key, def = null) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : def }
export function setSetting(key, value) { db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value == null ? '' : String(value)) }

export function dbStats() {
  const q = (sql) => db.prepare(sql).get().n
  return {
    snapshots: q('SELECT COUNT(*) n FROM snapshots'),
    reels: q('SELECT COUNT(*) n FROM reels'),
    products: q('SELECT COUNT(*) n FROM products'),
  }
}
