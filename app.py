# -*- coding: utf-8 -*-
"""
MFDS Regulatory Dashboard - External DB Version

- Streamlit Cloud / GitHub 배포용
- DATABASE_URL이 있으면 PostgreSQL/Supabase 사용
- DATABASE_URL이 없으면 Local SQLite fallback 사용
- 식약처 게시물 자동 수집, 누적 저장, 기간/구분별 조회
"""

import html
import os
import re
import time
import hashlib
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlencode, parse_qsl, urlunparse

import pandas as pd
import requests
import streamlit as st
import streamlit.components.v1 as components
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


APP_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = APP_DIR / "output"
LOG_DIR = APP_DIR / "logs"
DATA_DIR = APP_DIR / "data"

OUTPUT_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

LOCAL_DB_PATH = DATA_DIR / "mfds_monitor_local.db"
TODAY = date.today()
APP_VERSION = "v11-deploy-check-dateback"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MFDSDashboard/ExternalDB",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

BOARD_ID_LABEL_MAP = {
    "m_74": "공지",
    "m_76": "공고",
    "m_99": "보도자료",
    "m_203": "법, 시행령, 시행규칙",
    "m_211": "고시전문",
    "m_212": "훈령전문",
    "m_215": "예규전문",
    "m_207": "제개정고시등",
    "m_209": "입법/행정예고",
    "m_1059": "공무원지침서",
    "m_1060": "민원인안내서",
    "m_218": "안내서/지침",
    "m_220": "학술토론회",
    "m_231": "전문홍보물",
}

MFDS_SOURCES = [
    {"board_id": "m_74", "url": "https://www.mfds.go.kr/brd/m_74/list.do"},
    {"board_id": "m_76", "url": "https://www.mfds.go.kr/brd/m_76/list.do"},
    {"board_id": "m_99", "url": "https://www.mfds.go.kr/brd/m_99/list.do"},
    {"board_id": "m_203", "url": "https://www.mfds.go.kr/brd/m_203/list.do"},
    {"board_id": "m_211", "url": "https://www.mfds.go.kr/brd/m_211/list.do"},
    {"board_id": "m_212", "url": "https://www.mfds.go.kr/brd/m_212/list.do"},
    {"board_id": "m_215", "url": "https://www.mfds.go.kr/brd/m_215/list.do"},
    {"board_id": "m_207", "url": "https://www.mfds.go.kr/brd/m_207/list.do"},
    {"board_id": "m_209", "url": "https://www.mfds.go.kr/brd/m_209/list.do"},
    {"board_id": "m_1059", "url": "https://www.mfds.go.kr/brd/m_1059/list.do"},
    {"board_id": "m_1060", "url": "https://www.mfds.go.kr/brd/m_1060/list.do"},
    {"board_id": "m_218", "url": "https://www.mfds.go.kr/brd/m_218/list.do"},
    {"board_id": "m_220", "url": "https://www.mfds.go.kr/brd/m_220/list.do"},
    {"board_id": "m_231", "url": "https://www.mfds.go.kr/brd/m_231/list.do"},
]


# -----------------------------
# DB
# -----------------------------
def get_secret_value(*names, default=""):
    for name in names:
        try:
            value = st.secrets.get(name, "")
        except Exception:
            value = ""
        if value not in [None, ""]:
            return str(value)

        value = os.environ.get(name, "")
        if value:
            return str(value)

    return default


def get_secret_bool(name, default=False):
    try:
        value = st.secrets.get(name, None)
    except Exception:
        value = None
    if value is None:
        value = os.environ.get(name, None)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ["1", "true", "yes", "y", "on"]


def get_database_url():
    # Supabase 운영형: DATABASE_URL 또는 SUPABASE_DB_URL 중 하나를 사용
    db_url = get_secret_value("DATABASE_URL", "SUPABASE_DB_URL", default="")

    if db_url:
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        return db_url

    # 로컬 테스트용 fallback
    return "sqlite:///" + str(LOCAL_DB_PATH).replace("\\", "/")


@st.cache_resource(show_spinner=False)
def get_engine():
    url = get_database_url()
    connect_args = {}
    if url.startswith("sqlite:///"):
        connect_args = {"check_same_thread": False}
    else:
        # Supabase 연결 지연 시 Streamlit이 흰 로딩 화면에서 오래 멈추는 문제 방지
        connect_args = {"connect_timeout": 8, "sslmode": "require"}

    return create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args=connect_args,
    )


def is_external_db():
    return not get_database_url().startswith("sqlite:///")


def is_supabase_mode():
    return is_external_db()


def db_mode_label():
    return "Supabase PostgreSQL" if is_supabase_mode() else "Local SQLite"


def safe_db_error_message(e):
    msg = str(e)
    msg = re.sub(r"postgresql://[^\s\"']+", "postgresql://***", msg)
    msg = re.sub(r"postgres://[^\s\"']+", "postgres://***", msg)
    return msg[:1400]


def init_db():
    engine = get_engine()
    is_sqlite = get_database_url().startswith("sqlite:///")

    with engine.begin() as conn:
        if is_sqlite:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    site TEXT NOT NULL,
                    category TEXT,
                    board_id TEXT,
                    item_date TEXT,
                    title TEXT NOT NULL,
                    url TEXT,
                    item_key TEXT UNIQUE,
                    collected_at TEXT
                )
            """))
        else:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS items (
                    id BIGSERIAL PRIMARY KEY,
                    site TEXT NOT NULL,
                    category TEXT,
                    board_id TEXT,
                    item_date TEXT,
                    title TEXT NOT NULL,
                    url TEXT,
                    item_key TEXT UNIQUE,
                    collected_at TEXT
                )
            """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_items_date ON items(item_date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_items_category_date ON items(category, item_date)"))


def get_meta(key, default=""):
    init_db()
    with get_engine().begin() as conn:
        row = conn.execute(text("SELECT value FROM meta WHERE key = :key"), {"key": key}).fetchone()
    return row[0] if row else default


def set_meta(key, value):
    init_db()
    is_sqlite = get_database_url().startswith("sqlite:///")
    with get_engine().begin() as conn:
        if is_sqlite:
            conn.execute(
                text("INSERT OR REPLACE INTO meta(key, value) VALUES(:key, :value)"),
                {"key": key, "value": value},
            )
        else:
            conn.execute(
                text("""
                    INSERT INTO meta(key, value)
                    VALUES(:key, :value)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """),
                {"key": key, "value": value},
            )


def item_hash(site, category, item_date, title, url):
    raw = f"{site}|{category}|{item_date}|{norm(title)}|{url}"
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def db_insert_items(rows):
    init_db()
    if not rows:
        return 0, 0

    is_sqlite = get_database_url().startswith("sqlite:///")
    inserted = 0
    skipped = 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_engine().begin() as conn:
        for r in rows:
            params = {
                "site": r.get("site", "식약처"),
                "category": r.get("category", ""),
                "board_id": r.get("board_id", ""),
                "item_date": r.get("item_date", ""),
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "item_key": item_hash(
                    r.get("site", "식약처"),
                    r.get("category", ""),
                    r.get("item_date", ""),
                    r.get("title", ""),
                    r.get("url", ""),
                ),
                "collected_at": now,
            }

            try:
                if is_sqlite:
                    result = conn.execute(
                        text("""
                            INSERT OR IGNORE INTO items
                            (site, category, board_id, item_date, title, url, item_key, collected_at)
                            VALUES (:site, :category, :board_id, :item_date, :title, :url, :item_key, :collected_at)
                        """),
                        params,
                    )
                else:
                    result = conn.execute(
                        text("""
                            INSERT INTO items
                            (site, category, board_id, item_date, title, url, item_key, collected_at)
                            VALUES (:site, :category, :board_id, :item_date, :title, :url, :item_key, :collected_at)
                            ON CONFLICT (item_key) DO NOTHING
                        """),
                        params,
                    )

                if result.rowcount == 1:
                    inserted += 1
                else:
                    skipped += 1
            except IntegrityError:
                skipped += 1

    return inserted, skipped


def db_count():
    init_db()
    with get_engine().begin() as conn:
        n = conn.execute(text("SELECT COUNT(*) FROM items")).scalar()
    return int(n or 0)


def db_load_all():
    init_db()
    with get_engine().begin() as conn:
        df = pd.read_sql_query(
            text("""
                SELECT site, category, board_id, item_date, title, url, collected_at
                FROM items
                ORDER BY item_date DESC, id DESC
            """),
            conn,
        )

    if df.empty:
        df = pd.DataFrame(columns=["site", "category", "board_id", "item_date", "title", "url", "collected_at"])

    df["게시일"] = df["item_date"].fillna("")
    df["구분"] = df["category"].fillna("")
    df["게시판ID"] = df["board_id"].fillna("")
    df["제목"] = df["title"].fillna("")
    df["링크"] = df["url"].fillna("")
    df["게시일_dt"] = pd.to_datetime(df["게시일"], errors="coerce").dt.date
    return df


def db_last_collected():
    init_db()
    with get_engine().begin() as conn:
        v = conn.execute(text("SELECT MAX(collected_at) FROM items")).scalar()
    return v or "-"


# -----------------------------
# Utilities
# -----------------------------
def write_log(message):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    LOG_DIR.mkdir(exist_ok=True)
    with open(LOG_DIR / "app_collect.log", "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {message}\n")


def norm(x):
    return re.sub(r"\s+", " ", str(x or "")).strip()


def esc(x):
    return html.escape(str(x or ""), quote=True)


def board_label(board_id):
    return BOARD_ID_LABEL_MAP.get(str(board_id or "").strip(), str(board_id or "").strip())


def make_session():
    s = requests.Session()
    retry = Retry(
        total=1,
        connect=1,
        read=1,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update(HEADERS)
    return s


SESSION = make_session()


def fetch_html(url, timeout=12):
    last = None
    for i in range(1, 3):
        try:
            r = SESSION.get(url, timeout=(5, timeout))
            r.raise_for_status()
            r.encoding = r.apparent_encoding or "utf-8"
            return r.text
        except Exception as e:
            last = e
            time.sleep(i * 0.5)
    raise last


def parse_date_any(text_value):
    if not text_value:
        return None
    t = norm(text_value)

    m = re.search(r"(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})", t)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass

    m = re.search(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", t)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass

    return None


def add_or_replace_query_param(url, key, value):
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[key] = str(value)
    new_query = urlencode(query, doseq=True)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))


def mfds_paged_url(base_url, page_no):
    if int(page_no) <= 1:
        return base_url
    return add_or_replace_query_param(base_url, "page", int(page_no))


def is_bad_title(title):
    t = norm(title)
    if not t or len(t) < 5:
        return True
    bad_exact = {
        "로그인", "회원가입", "검색", "이전", "다음", "처음", "마지막",
        "더보기", "목록", "메뉴", "본문 바로가기", "전체 메뉴", "RSS",
        "누리집 안내지도", "전체메뉴", "바로가기"
    }
    if t in bad_exact:
        return True
    if re.fullmatch(r"\d+", t):
        return True
    if len(t) > 200:
        return True
    return False


# -----------------------------
# MFDS scraping
# -----------------------------
def is_valid_mfds_title(title):
    t = norm(title)
    if is_bad_title(t):
        return False

    bad_words = [
        "다운받기", "미리보기", "첨부파일", "새로운게시물", "파일첨부",
        "목록", "페이스북", "트위터", "인쇄", "공유", "카카오",
        "부서별직원안내", "부산청인스타그램", "식약처 인스타그램",
        "유튜브", "블로그", "누리집", "처음으로", "페이지",
        "검색어 검색", "제목 내용 담당부서", "분야별선택", "특수문자 검색 불가"
    ]
    if any(w in t for w in bad_words):
        return False

    if re.fullmatch(r"20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}", t):
        return False
    if re.fullmatch(r"\d{1,7}", t):
        return False
    if re.search(r"\.(pdf|hwpx|hwp|docx|xlsx|xls|zip|png|jpg|jpeg)$", t, re.I):
        return False
    if t.startswith("담당부서") or t.startswith("조회수"):
        return False
    if len(t) < 5:
        return False
    return True


def extract_seq_from_url(url):
    m = re.search(r"(?:seq|nttId|articleNo|itm_seq_1)=([0-9]+)", str(url or ""))
    return m.group(1) if m else ""


def normalize_item_url(base_url, href):
    return urljoin(base_url, href or "")


def normalize_title_key(title):
    t = norm(title)
    t = t.replace("새로운게시물", "").strip()
    t = re.sub(r"\s+", " ", t)
    return t


def mfds_main_area(soup):
    return (
        soup.select_one("#contents")
        or soup.select_one("#content")
        or soup.select_one("main")
        or soup.select_one(".content")
        or soup.select_one(".contents")
        or soup.select_one(".board-list")
        or soup.select_one(".board_list")
        or soup
    )


def build_mfds_anchor_index(soup, page_url):
    """
    제목 텍스트 → view URL 매핑.
    식약처 페이지는 목록 텍스트와 링크가 분리되어 보여도 a 태그에는 view.do URL이 있음.
    """
    index = {}
    candidates = []

    for a in soup.find_all("a"):
        href = a.get("href") or ""
        onclick = a.get("onclick") or ""
        raw_text = norm(a.get_text(" ", strip=True))
        title = normalize_title_key(raw_text)

        if not is_valid_mfds_title(title):
            continue

        is_view = ("view.do" in href) or ("seq=" in href) or ("itm_seq" in href)
        seq = extract_seq_from_url(href)

        if not is_view and onclick:
            m = re.search(r"(?:seq|goView|view)\D+([0-9]{3,})", onclick)
            if m:
                seq = m.group(1)
                is_view = True

        if not is_view:
            continue

        link = normalize_item_url(page_url, href) if href else page_url
        if seq and "seq=" not in link:
            # href가 javascript이거나 seq가 onclick에만 있는 경우 최소 view URL 구성
            link = normalize_item_url(page_url, f"view.do?page=1&seq={seq}")

        candidates.append((title, link))

    # 긴 제목 우선 저장. 동일 제목 중복 시 첫 링크 유지.
    for title, link in sorted(candidates, key=lambda x: len(x[0]), reverse=True):
        index.setdefault(title, link)

    return index


def find_link_for_title(title, anchor_index, page_url):
    key = normalize_title_key(title)
    if key in anchor_index:
        return anchor_index[key]

    # 완전 일치가 안 되면 포함관계로 보조 매칭
    for k, v in anchor_index.items():
        if key and (key in k or k in key):
            return v

    return page_url


def parse_mfds_items_from_tr(soup, page_url, start_date, end_date, board_id, category):
    rows = []
    page_dates = []

    for tr in soup.find_all("tr"):
        txt = norm(tr.get_text(" ", strip=True))
        d = parse_date_any(txt)
        if not d:
            continue

        page_dates.append(d)
        if d < start_date or d > end_date:
            continue

        anchors = tr.find_all("a")
        title_anchor = None

        for a in anchors:
            href = a.get("href") or ""
            atext = normalize_title_key(a.get_text(" ", strip=True))
            if not is_valid_mfds_title(atext):
                continue
            if ("view.do" in href) or ("seq=" in href) or ("itm_seq" in href):
                title_anchor = a
                break

        if not title_anchor:
            valid = []
            for a in anchors:
                atext = normalize_title_key(a.get_text(" ", strip=True))
                if is_valid_mfds_title(atext):
                    valid.append((len(atext), a))
            if valid:
                title_anchor = sorted(valid, key=lambda x: x[0], reverse=True)[0][1]

        if not title_anchor:
            continue

        title = normalize_title_key(title_anchor.get_text(" ", strip=True))
        link = normalize_item_url(page_url, title_anchor.get("href") or page_url)

        rows.append({
            "site": "식약처",
            "category": category,
            "board_id": board_id,
            "item_date": d.isoformat(),
            "title": title,
            "url": link,
            "_parser": "tr",
        })

    return rows, page_dates


def parse_mfds_items_from_cards(soup, page_url, start_date, end_date, board_id, category):
    rows = []
    page_dates = []
    candidates = []
    main_area = mfds_main_area(soup)

    candidates.extend(main_area.find_all("li"))
    candidates.extend(main_area.find_all("div", class_=re.compile(r"(list|board|item|bbs|news)", re.I)))

    seen_blocks = set()

    for block in candidates:
        txt = norm(block.get_text(" ", strip=True))
        if not txt:
            continue

        block_sig = txt[:250]
        if block_sig in seen_blocks:
            continue
        seen_blocks.add(block_sig)

        d = parse_date_any(txt)
        if not d:
            continue

        page_dates.append(d)
        if d < start_date or d > end_date:
            continue

        anchors = block.find_all("a")
        if not anchors:
            continue

        title_candidates = []
        for a in anchors:
            href = a.get("href") or ""
            atext = normalize_title_key(a.get_text(" ", strip=True))
            if not is_valid_mfds_title(atext):
                continue

            score = len(atext)
            if "view.do" in href:
                score += 100
            if "seq=" in href or "itm_seq" in href:
                score += 50
            title_candidates.append((score, a))

        if not title_candidates:
            continue

        title_anchor = sorted(title_candidates, key=lambda x: x[0], reverse=True)[0][1]
        title = normalize_title_key(title_anchor.get_text(" ", strip=True))
        link = normalize_item_url(page_url, title_anchor.get("href") or page_url)

        rows.append({
            "site": "식약처",
            "category": category,
            "board_id": board_id,
            "item_date": d.isoformat(),
            "title": title,
            "url": link,
            "_parser": "card",
        })

    return rows, page_dates


def parse_mfds_items_from_text_lines(soup, page_url, start_date, end_date, board_id, category):
    """
    v10 fallback 파서.
    v8/v9의 '게시번호 marker → block → 날짜' 방식은 조회수 숫자(예: 161)가 게시번호로 오인되면
    block이 날짜 전에 끊겨 0건이 될 수 있었다.

    이번 방식은 반대로 '순수 등록일 라인'을 먼저 찾고, 그 위쪽 30줄 안에서 가장 가까운 정상 제목을 찾는다.
    식약처 목록 구조가 제목→담당부서→조회수→첨부파일→등록일 순서이므로 이 방식이 더 안정적이다.
    """
    rows = []
    page_dates = []

    anchor_index = build_mfds_anchor_index(soup, page_url)
    raw_lines = soup.get_text("\n", strip=True).splitlines()
    lines = [norm(x) for x in raw_lines if norm(x)]

    def parse_pure_date_line(line):
        t = norm(line)
        m = re.fullmatch(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", t)
        if not m:
            return None
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            return None

    def is_noise_line(line):
        t = norm(line)
        if not t:
            return True
        noise_exact = {
            "새로운게시물", "펼치기", "접기", "미리보기", "다운받기",
            "검색어 검색", "닫기", "열기", "전체", "공통", "식품", "의약품",
            "의료기기", "바이오", "화장품", "한약", "위생용품", "백신치료제", "의약외품",
            "제목 내용 담당부서", "제목", "내용", "담당부서"
        }
        if t in noise_exact:
            return True
        if t.startswith("담당부서") or t.startswith("조회수"):
            return True
        if t.startswith("분야별선택") or t.startswith("등록번호입력예시"):
            return True
        if "특수문자 검색 불가" in t:
            return True
        if re.fullmatch(r"\d{1,7}", t):
            return True
        if re.fullmatch(r"조회수\s*\|\s*\d+", t):
            return True
        if re.search(r"\.(pdf|hwpx|hwp|docx|xlsx|xls|zip|png|jpg|jpeg)$", t, re.I):
            return True
        if "미리보기" in t or "다운받기" in t:
            return True
        if parse_pure_date_line(t):
            return True
        return False

    def is_list_start_line(line):
        return bool(re.search(r"전체\s*[0-9,]+\s*건", norm(line)))

    def is_list_end_line(line):
        t = norm(line)
        if t in ["첫 페이지", "이전 페이지", "다음 페이지", "마지막 페이지", "개인정보처리방침", "저작권정책", "TOP"]:
            return True
        if "Copyright" in t or "종합상담센터" in t:
            return True
        return False

    # 목록 시작 위치
    start_idx = 0
    for i, line in enumerate(lines):
        if is_list_start_line(line):
            start_idx = i + 1
            break

    seen = set()

    for idx in range(start_idx, len(lines)):
        line = lines[idx]
        if is_list_end_line(line):
            break

        d = parse_pure_date_line(line)
        if not d:
            continue

        page_dates.append(d)

        if d < start_date or d > end_date:
            continue

        title = ""

        # 1차: 위쪽에서 anchor_index에 존재하는 제목 우선
        scan_start = max(start_idx, idx - 35)
        for j in range(idx - 1, scan_start - 1, -1):
            cand = normalize_title_key(lines[j])
            if is_noise_line(cand):
                continue
            if cand in anchor_index and is_valid_mfds_title(cand):
                title = cand
                break

        # 2차: anchor_index 완전일치가 안 되면 일반 정상 제목 후보
        if not title:
            for j in range(idx - 1, scan_start - 1, -1):
                cand = normalize_title_key(lines[j])
                if is_noise_line(cand):
                    continue
                if is_valid_mfds_title(cand):
                    title = cand
                    break

        if not title:
            continue

        link = find_link_for_title(title, anchor_index, page_url)
        key = f"{d.isoformat()}|{title}"
        if key in seen:
            continue
        seen.add(key)

        rows.append({
            "site": "식약처",
            "category": category,
            "board_id": board_id,
            "item_date": d.isoformat(),
            "title": title,
            "url": link,
            "_parser": "dateback",
        })

    return rows, page_dates


def parse_mfds_board_page(src, page_url, start_date, end_date):
    rows = []
    page_dates = []
    board_id = src["board_id"]
    category = board_label(board_id)

    try:
        html_text = fetch_html(page_url)
        soup = BeautifulSoup(html_text, "html.parser")

        tr_rows, tr_dates = parse_mfds_items_from_tr(soup, page_url, start_date, end_date, board_id, category)
        card_rows, card_dates = parse_mfds_items_from_cards(soup, page_url, start_date, end_date, board_id, category)
        text_rows, text_dates = parse_mfds_items_from_text_lines(soup, page_url, start_date, end_date, board_id, category)

        rows.extend(tr_rows)
        rows.extend(card_rows)
        rows.extend(text_rows)
        page_dates.extend(tr_dates)
        page_dates.extend(card_dates)
        page_dates.extend(text_dates)

        # 페이지 내 중복 제거: seq 우선, 없으면 날짜+제목
        deduped = []
        seen = set()
        parser_counts = {"tr": 0, "card": 0, "text": 0}
        for r in rows:
            seq = extract_seq_from_url(r.get("url", ""))
            key = seq or f"{r.get('item_date','')}|{r.get('title','')}"
            if key not in seen:
                seen.add(key)
                parser_counts[r.get("_parser", "unknown")] = parser_counts.get(r.get("_parser", "unknown"), 0) + 1
                r.pop("_parser", None)
                deduped.append(r)

        full_text_lines = [norm(x) for x in soup.get_text("\n", strip=True).splitlines() if norm(x)]
        has_total_marker = any(re.search(r"전체\s*[0-9,]+\s*건", x) for x in full_text_lines)
        first_date = ""
        all_dates = [d.isoformat() for d in page_dates if d]
        if all_dates:
            first_date = max(all_dates)

        src["_last_debug"] = {
            "html_len": len(html_text or ""),
            "line_count": len(full_text_lines),
            "has_total_marker": has_total_marker,
            "tr": len(tr_rows),
            "card": len(card_rows),
            "text": len(text_rows),
            "deduped": len(deduped),
            "latest_date_on_page": first_date,
        }

        write_log(
            f"MFDS {board_id} page parse: html_len={len(html_text or '')}, "
            f"lines={len(full_text_lines)}, total_marker={has_total_marker}, "
            f"tr={len(tr_rows)}, card={len(card_rows)}, dateback={len(text_rows)}, "
            f"deduped={len(deduped)}, latest_date={first_date}"
        )
        return deduped, page_dates

    except Exception as e:
        src["_last_debug"] = {
            "html_len": 0,
            "line_count": 0,
            "has_total_marker": False,
            "tr": 0,
            "card": 0,
            "text": 0,
            "deduped": 0,
            "latest_date_on_page": "",
            "error": str(e)[:200],
        }
        write_log(f"MFDS {board_id} 페이지 실패 {page_url}: {e}")
        return rows, page_dates


def parse_mfds_board(src, start_date, end_date, max_pages=40):
    all_rows = []
    board_id = src["board_id"]
    category = board_label(board_id)
    previous_page_signature = None
    empty_count = 0

    for page_no in range(1, int(max_pages) + 1):
        page_url = mfds_paged_url(src["url"], page_no)
        rows, page_dates = parse_mfds_board_page(src, page_url, start_date, end_date)

        signature_source = rows[:12] if rows else []
        signature = "|".join([f"{r.get('item_date','')}:{r.get('title','')}" for r in signature_source])

        if page_no > 1 and signature and signature == previous_page_signature:
            write_log(f"MFDS {board_id} {category}: page 중복 감지로 중단 page={page_no}")
            break
        if signature:
            previous_page_signature = signature

        if rows:
            all_rows.extend(rows)
            empty_count = 0
        else:
            empty_count += 1

        if page_dates:
            if max(page_dates) < start_date:
                break
            if min(page_dates) < start_date and page_no > 1:
                break

        if page_no > 1 and empty_count >= 3:
            break

        time.sleep(0.12)

    deduped = []
    seen = set()
    for r in all_rows:
        seq = extract_seq_from_url(r.get("url", ""))
        key = seq or item_hash(r.get("site", ""), r.get("category", ""), r.get("item_date", ""), r.get("title", ""), r.get("url", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    write_log(f"MFDS {board_id} {category}: {len(deduped)}건 / 다중페이지 수집")
    return deduped


def collect_mfds_to_db(start_date, end_date, collect_mode="period"):
    """
    collect_mode
    - fast   : 각 게시판 첫 페이지만 확인. 최신 신규 확인용.
    - period : 선택 기간 전체 수집. 날짜 기준으로 여러 페이지 확인.
    """
    rows = []
    board_reports = []
    days = max(1, (end_date - start_date).days + 1)

    if collect_mode == "fast":
        max_pages = 1
    else:
        max_pages = 10 if days <= 31 else 25 if days <= 180 else 60

    total_inserted = 0
    total_skipped = 0
    total_checked = 0

    for src in MFDS_SOURCES:
        board_id = src["board_id"]
        category = board_label(board_id)

        board_rows = parse_mfds_board(src, start_date, end_date, max_pages=max_pages)
        inserted, skipped = db_insert_items(board_rows)
        checked = len(board_rows)

        total_inserted += inserted
        total_skipped += skipped
        total_checked += checked
        rows.extend(board_rows)

        latest_date = max([r.get("item_date", "") for r in board_rows], default="")
        dbg = src.get("_last_debug", {}) or {}
        board_reports.append({
            "구분": category,
            "게시판ID": board_id,
            "확인": checked,
            "신규": inserted,
            "중복": skipped,
            "최신게시일": latest_date,
            "페이지최신일": dbg.get("latest_date_on_page", ""),
            "HTML크기": dbg.get("html_len", 0),
            "라인수": dbg.get("line_count", 0),
            "전체건표식": "Y" if dbg.get("has_total_marker") else "N",
            "TR": dbg.get("tr", 0),
            "CARD": dbg.get("card", 0),
            "DATEBACK": dbg.get("text", 0),
            "오류": dbg.get("error", ""),
        })

        time.sleep(0.15)

    st.session_state["last_collect_report"] = board_reports
    return total_inserted, total_skipped, total_checked


def render_collect_report():
    report = st.session_state.get("last_collect_report", [])

    with st.expander(f"게시판별 수집 결과 / 파서 진단 보기 ({APP_VERSION})", expanded=False):
        if not report:
            st.caption("아직 이 브라우저 세션에서 수집 버튼을 실행한 결과가 없습니다. 빠른수집 또는 기간수집을 실행하면 게시판별 진단표가 표시됩니다.")
            st.markdown(
                """
                진단 기준:
                - `확인` = 파서가 해당 게시판에서 읽은 게시물 수
                - `신규` = Supabase에 새로 저장된 수
                - `중복` = 이미 DB에 있어 제외된 수
                - `DATEBACK` = v10/v11 등록일 기준 역방향 파서 결과
                """
            )
            return

        df_report = pd.DataFrame(report)
        if df_report.empty:
            st.caption("수집 결과가 비어 있습니다.")
            return

        st.dataframe(
            df_report,
            hide_index=True,
            use_container_width=True,
            column_config={
                "구분": st.column_config.TextColumn("구분", width="medium"),
                "게시판ID": st.column_config.TextColumn("게시판ID", width="small"),
                "확인": st.column_config.NumberColumn("확인", width="small"),
                "신규": st.column_config.NumberColumn("신규", width="small"),
                "중복": st.column_config.NumberColumn("중복", width="small"),
                "최신게시일": st.column_config.TextColumn("최신게시일", width="small"),
                "페이지최신일": st.column_config.TextColumn("페이지최신일", width="small"),
                "HTML크기": st.column_config.NumberColumn("HTML크기", width="small"),
                "라인수": st.column_config.NumberColumn("라인수", width="small"),
                "전체건표식": st.column_config.TextColumn("전체건표식", width="small"),
                "TR": st.column_config.NumberColumn("TR", width="small"),
                "CARD": st.column_config.NumberColumn("CARD", width="small"),
                "DATEBACK": st.column_config.NumberColumn("DATEBACK", width="small"),
                "오류": st.column_config.TextColumn("오류", width="large"),
            },
        )



def auto_collect_once_per_day(start_date, end_date):
    today_key = TODAY.isoformat()
    last_auto = get_meta("last_auto_collect_date", "")
    if last_auto == today_key:
        return False

    write_log(f"자동 수집 시작: {start_date} ~ {end_date}")
    collect_mfds_to_db(start_date, end_date)
    set_meta("last_auto_collect_date", today_key)
    write_log("자동 수집 종료")
    return True


# -----------------------------
# Data filters
# -----------------------------
def period_dates(label, start_date=None, end_date=None):
    if label == "직접 선택":
        return start_date or TODAY, end_date or TODAY
    if label == "오늘":
        return TODAY, TODAY
    if label == "최근 7일":
        return TODAY - timedelta(days=7), TODAY
    return TODAY - timedelta(days=14), TODAY


def filter_period_keyword(df, period_label, keyword="", start_date=None, end_date=None):
    start, end = period_dates(period_label, start_date, end_date)
    out = df.copy()
    out = out[(out["게시일_dt"].notna()) & (out["게시일_dt"] >= start) & (out["게시일_dt"] <= end)]

    if keyword:
        kw = keyword.strip()
        mask = (
            out["제목"].fillna("").str.contains(kw, case=False, regex=False)
            | out["구분"].fillna("").str.contains(kw, case=False, regex=False)
            | out["게시판ID"].fillna("").str.contains(kw, case=False, regex=False)
        )
        out = out[mask]

    return out


def count_in_period(df, days):
    start = TODAY if days == 0 else TODAY - timedelta(days=days)
    return len(df[(df["게시일_dt"].notna()) & (df["게시일_dt"] >= start) & (df["게시일_dt"] <= TODAY)])


# -----------------------------
# UI HTML/CSS
# -----------------------------
BASE_CSS = """
<style>
:root {
  --ha-navy: #071A3D;
  --ha-navy-2: #102B63;
  --ha-blue: #2B74FF;
  --ha-cyan: #21C7D9;
  --ha-green: #1CC88A;
  --ha-amber: #FFB547;
  --ha-bg: #F4F7FC;
  --ha-line: #D9E3F2;
  --ha-text: #0B1736;
  --ha-muted: #64748B;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', Arial, sans-serif;
  color: var(--ha-text);
  background: transparent;
}
.ha-hero {
  position: relative;
  overflow: hidden;
  min-height: 172px;
  padding: 24px 30px 26px 30px;
  border-radius: 24px;
  background:
    radial-gradient(circle at 84% 18%, rgba(33,199,217,.28) 0, rgba(33,199,217,0) 28%),
    radial-gradient(circle at 18% 88%, rgba(255,181,71,.20) 0, rgba(255,181,71,0) 30%),
    linear-gradient(135deg, #071A3D 0%, #0D2A61 50%, #123B83 100%);
  box-shadow: 0 18px 42px rgba(7, 26, 61, .22);
  color: #fff;
}
.ha-hero:before {
  content: "";
  position: absolute;
  right: -84px;
  top: -92px;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  border: 40px solid rgba(255,255,255,.08);
}
.ha-hero:after {
  content: "";
  position: absolute;
  right: 46px;
  bottom: 16px;
  width: 120px;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--ha-blue), var(--ha-green), var(--ha-amber));
  opacity: .9;
}
.ha-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255,255,255,.13);
  border: 1px solid rgba(255,255,255,.22);
  color: #EAF6FF;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .02em;
}
.ha-mark {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 7px;
  background: conic-gradient(from 210deg, var(--ha-blue), var(--ha-cyan), var(--ha-green), var(--ha-amber), var(--ha-blue));
  box-shadow: 0 0 0 2px rgba(255,255,255,.16);
}
.ha-title {
  margin-top: 16px;
  font-size: 34px;
  line-height: 1.08;
  font-weight: 900;
  letter-spacing: -.9px;
}
.ha-subtitle {
  margin-top: 9px;
  max-width: 760px;
  color: rgba(236,246,255,.86);
  font-size: 14px;
  line-height: 1.6;
}
.ha-chip-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.ha-mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.15);
  color: rgba(255,255,255,.86);
  font-size: 12px;
  font-weight: 700;
}
.ha-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-blue { background: var(--ha-blue); }
.dot-green { background: var(--ha-green); }
.dot-amber { background: var(--ha-amber); }

.card {
  position: relative;
  background: rgba(255,255,255,.94);
  border: 1px solid rgba(217,227,242,.95);
  border-radius: 20px;
  box-shadow: 0 14px 34px rgba(8, 30, 70, .08);
  overflow: hidden;
}
.card:before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 4px;
  background: linear-gradient(90deg, var(--ha-blue), var(--ha-cyan), var(--ha-green), var(--ha-amber));
}
.summary-card {
  min-height: 108px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 24px 20px 24px;
}
.summary-title {
  font-size: 14px;
  color: var(--ha-muted);
  font-weight: 800;
  margin-bottom: 4px;
}
.summary-value {
  font-size: 34px;
  line-height: 1;
  color: var(--ha-navy);
  font-weight: 950;
  letter-spacing: -.8px;
}
.summary-sub {
  margin-top: 6px;
  color: var(--ha-blue);
  font-size: 13px;
  font-weight: 800;
}
.header {
  min-height: 64px;
  border-bottom: 1px solid var(--ha-line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 20px 0 20px;
  background:
    linear-gradient(180deg, rgba(244,247,252,.72), rgba(255,255,255,.92));
}
.title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 21px;
  font-weight: 900;
  color: var(--ha-navy);
  letter-spacing: -.3px;
}
.count-chip {
  display: inline-block;
  background: #EAF2FF;
  color: var(--ha-blue);
  border: 1px solid #C9DDFE;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 900;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th {
  color: var(--ha-navy);
  font-size: 13px;
  font-weight: 900;
  background: #F7FAFF;
  border-bottom: 1px solid var(--ha-line);
  padding: 12px 14px;
  text-align: left;
}
td {
  border-bottom: 1px solid #E8EEF7;
  padding: 13px 14px;
  font-size: 13px;
  color: #22314C;
  vertical-align: middle;
}
tr:nth-child(even) td { background: #FBFDFF; }
tr:last-child td { border-bottom: none; }
.date-cell {
  white-space: nowrap;
  color: #344054;
  width: 108px;
  font-weight: 650;
}
.type-cell {
  white-space: nowrap;
  width: 150px;
}
.title-cell {
  color: #14213D;
  font-weight: 650;
  line-height: 1.5;
}
.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
  white-space: nowrap;
  background: linear-gradient(135deg, #EAF2FF, #EAFBF7);
  color: var(--ha-blue);
  border: 1px solid rgba(43,116,255,.14);
}
.empty {
  text-align: center;
  color: #94A3B8;
  padding: 32px !important;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px 20px;
  border-bottom: 1px solid var(--ha-line);
  background:
    linear-gradient(90deg, rgba(7,26,61,.06), rgba(43,116,255,.04), rgba(28,200,138,.03));
}
.detail-title {
  font-size: 22px;
  color: var(--ha-navy);
  font-weight: 950;
  letter-spacing: -.4px;
}
.selected-chip {
  margin-left: 10px;
  display: inline-block;
  background: #EEF7FF;
  color: var(--ha-blue);
  border: 1px solid #C9DDFE;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 900;
}
.open-link {
  color: var(--ha-blue);
  font-weight: 900;
  text-decoration: none;
  white-space: nowrap;
}
.open-link:hover {
  text-decoration: underline;
}
</style>
"""


def hero_html():
    db_text = "Supabase DB" if is_supabase_mode() else "Local SQLite"
    return f"""
    {BASE_CSS}
    <section class="ha-hero">
      <div class="ha-kicker"><span class="ha-mark"></span> MFDS MONITORING</div>
      <div class="ha-title">Regulatory Update Dashboard</div>
      <div class="ha-subtitle">식약처 게시물을 자동 수집·누적 DB로 관리하고, 전체 정보와 구분별 정보를 한 화면에서 빠르게 확인합니다.</div>
      <div class="ha-chip-row">
        <span class="ha-mini-chip"><span class="ha-dot dot-blue"></span>MFDS</span>
        <span class="ha-mini-chip"><span class="ha-dot dot-green"></span>{esc(db_text)}</span>
        <span class="ha-mini-chip"><span class="ha-dot dot-amber"></span>Manual Query/Collect</span>
      </div>
    </section>
    """


def summary_card_html(label, value, sub):
    return f"""
    {BASE_CSS}
    <div class="card summary-card">
      <div>
        <div class="summary-title">{esc(label)}</div>
        <div class="summary-value">{value}건</div>
        <div class="summary-sub">{esc(sub)}</div>
      </div>
    </div>
    """


def preview_card_html(title, df):
    x = df.head(4)
    rows = ""
    if x.empty:
        rows = "<tr><td colspan='3' class='empty'>선택한 기간에 표시할 항목이 없습니다.</td></tr>"
    else:
        for _, r in x.iterrows():
            rows += f"""
            <tr>
              <td class="date-cell">{esc(r['게시일'])}</td>
              <td class="type-cell"><span class="badge">{esc(r['구분'])}</span></td>
              <td class="title-cell">{esc(r['제목'])}</td>
            </tr>
            """

    return f"""
    {BASE_CSS}
    <div class="card">
      <div class="header">
        <div class="title">{esc(title)} <span class="count-chip">최신 {len(x)}건</span></div>
      </div>
      <table>
        <thead><tr><th>게시일</th><th>구분</th><th>제목</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    """


def detail_table_html(title, df, page=1, page_size=10):
    total_rows = len(df)
    total_pages = max(1, (total_rows + page_size - 1) // page_size)
    page = max(1, min(int(page), total_pages))
    x = df.iloc[(page - 1) * page_size: page * page_size]

    rows = ""
    if x.empty:
        rows = "<tr><td colspan='4' class='empty'>표시할 항목이 없습니다.</td></tr>"
    else:
        for _, r in x.iterrows():
            rows += f"""
            <tr>
              <td class="date-cell">{esc(r['게시일'])}</td>
              <td class="type-cell"><span class="badge">{esc(r['구분'])}</span></td>
              <td class="title-cell">{esc(r['제목'])}</td>
              <td><a class="open-link" href="{esc(r['링크'])}" target="_blank">열기 ↗</a></td>
            </tr>
            """

    return f"""
    {BASE_CSS}
    <div class="card">
      <div class="detail-head">
        <div>
          <span class="detail-title">{esc(title)}</span>
          <span class="selected-chip">{page}/{total_pages}페이지 · 총 {total_rows}건</span>
        </div>
      </div>
      <table>
        <thead><tr><th>게시일</th><th>구분</th><th>제목</th><th>링크</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    """


def page_css():
    st.markdown("""
    <style>
    .stApp {
        background:
          radial-gradient(circle at 8% 8%, rgba(43,116,255,.10), transparent 28%),
          radial-gradient(circle at 92% 10%, rgba(28,200,138,.09), transparent 26%),
          linear-gradient(180deg, #F7FAFF 0%, #EEF3FA 100%);
    }
    .block-container {
        max-width: 1540px;
        padding-top: 1.05rem;
        padding-bottom: 1.6rem;
    }
    header[data-testid="stHeader"],
    div[data-testid="stToolbar"],
    div[data-testid="stDecoration"],
    div[data-testid="stStatusWidget"] {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
    }
    #MainMenu, footer {
        visibility: hidden !important;
    }
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
        border-bottom: 1px solid #D9E3F2;
    }
    .stTabs [data-baseweb="tab"] {
        height: 46px;
        padding: 0 18px;
        border-radius: 14px 14px 0 0;
        color: #334155;
        font-weight: 850;
    }
    .stTabs [aria-selected="true"] {
        color: #071A3D !important;
        background: linear-gradient(180deg, #FFFFFF, #F2F7FF);
        border: 1px solid #D9E3F2;
        border-bottom-color: #FFFFFF;
    }
    div[data-testid="stTextInput"] input,
    div[data-testid="stSelectbox"] div[data-baseweb="select"] > div,
    div[data-testid="stDateInput"] input {
        border-radius: 14px !important;
        border-color: #CBD8EA !important;
        box-shadow: 0 8px 20px rgba(8,30,70,.05);
    }
    div[data-testid="stButton"] > button {
        border: none;
        background: transparent;
        color: #2B74FF;
        box-shadow: none;
        padding: 0.15rem 0.28rem;
        min-height: 1.7rem;
        font-weight: 850;
    }
    div[data-testid="stButton"] > button:hover {
        background: #EAF2FF;
        border-radius: 8px;
        color: #071A3D;
    }
    div[data-testid="stButton"] > button:disabled {
        color: #94A3B8;
        background: transparent;
    }
    div[data-testid="stButton"] button[kind="primary"] {
        color: #fff !important;
        background: linear-gradient(135deg, #071A3D 0%, #2B74FF 100%) !important;
        border-radius: 14px !important;
        padding: .55rem .85rem !important;
        box-shadow: 0 12px 24px rgba(43,116,255,.22) !important;
    }
    .stDownloadButton button {
        border-radius: 14px !important;
        border: 1px solid #CBD8EA !important;
        background: #fff !important;
        color: #2B74FF !important;
        font-weight: 850 !important;
        box-shadow: 0 8px 20px rgba(8,30,70,.05);
    }
    div[data-testid="stRadio"] label {
        font-weight: 750;
        color: #22314C;
    }
    .stCaption, div[data-testid="stCaptionContainer"] {
        color: #64748B !important;
    }
    h1, h2, h3 {
        color: #071A3D !important;
        letter-spacing: -.45px;
    }
    </style>
    """, unsafe_allow_html=True)


def table_height(df, page=1, page_size=10, base=145):
    visible = df.iloc[(page - 1) * page_size: page * page_size]
    visible_rows = len(visible)
    wrap_extra = 0
    if not visible.empty and "제목" in visible.columns:
        wrap_extra = int(visible["제목"].fillna("").map(lambda x: max(0, len(str(x)) // 55)).sum() * 16)
    h = base + max(1, visible_rows) * 52 + wrap_extra + 12
    return max(280, min(h, 820))


def render_pagination(state_key, total_rows, page_size=10, max_buttons=10):
    total_pages = max(1, (total_rows + page_size - 1) // page_size)
    cur = int(st.session_state.get(state_key, 1))
    cur = max(1, min(cur, total_pages))
    st.session_state[state_key] = cur

    if total_pages <= 1:
        return

    start_page = max(1, cur - max_buttons // 2)
    end_page = min(total_pages, start_page + max_buttons - 1)
    start_page = max(1, end_page - max_buttons + 1)
    pages = list(range(start_page, end_page + 1))

    cols = st.columns([0.7] + [0.35] * len(pages) + [0.7] + [6])
    with cols[0]:
        if st.button("‹ 이전", key=f"{state_key}_prev", disabled=cur <= 1):
            st.session_state[state_key] = cur - 1
            st.rerun()

    for idx, pno in enumerate(pages, start=1):
        with cols[idx]:
            label = f"[{pno}]" if pno == cur else str(pno)
            if st.button(label, key=f"{state_key}_{pno}", disabled=pno == cur):
                st.session_state[state_key] = pno
                st.rerun()

    with cols[len(pages) + 1]:
        if st.button("다음 ›", key=f"{state_key}_next", disabled=cur >= total_pages):
            st.session_state[state_key] = cur + 1
            st.rerun()


def ordered_categories(df):
    existing = set([c for c in df["구분"].dropna().unique().tolist() if c])
    ordered = [v for v in BOARD_ID_LABEL_MAP.values() if v in existing]
    leftovers = sorted(existing - set(ordered))
    return ["전체"] + ordered + leftovers


def render_main_list(df, period, start_date=None, end_date=None):
    filtered = filter_period_keyword(df, period, st.session_state.get("keyword", ""), start_date, end_date)

    s1, s2, s3 = st.columns(3)
    with s1:
        components.html(summary_card_html("오늘 신규", count_in_period(df, 0), "오늘 등록 기준"), height=122)
    with s2:
        components.html(summary_card_html("최근 7일", count_in_period(df, 7), "최근 7일 등록 기준"), height=122)
    with s3:
        components.html(summary_card_html("최근 14일", count_in_period(df, 14), "최근 14일 등록 기준"), height=122)

    components.html(preview_card_html("식약처 최신 게시물", filtered), height=330)

    page_size = 10
    total_rows = len(filtered)
    total_pages = max(1, (total_rows + page_size - 1) // page_size)
    if st.session_state["main_page"] > total_pages:
        st.session_state["main_page"] = total_pages
    cur = st.session_state["main_page"]

    components.html(
        detail_table_html("식약처 상세 목록", filtered, cur, page_size),
        height=table_height(filtered, cur, page_size) + 20,
        scrolling=False,
    )
    render_pagination("main_page", total_rows, page_size)

    csv_bytes = filtered[["게시일", "구분", "제목", "링크"]].to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
    st.download_button("현재 목록 CSV 다운로드", data=csv_bytes, file_name=f"mfds_updates_{TODAY.strftime('%Y%m%d')}.csv", mime="text/csv")


def render_category_info_tab(df, period, start_date=None, end_date=None):
    st.subheader("구분별 정보")

    base = filter_period_keyword(df, period, st.session_state.get("keyword", ""), start_date, end_date)
    categories = ordered_categories(base)

    if st.session_state.get("selected_category", "전체") not in categories:
        st.session_state["selected_category"] = "전체"

    selected = st.radio(
        "구분 선택",
        categories,
        index=categories.index(st.session_state["selected_category"]),
        horizontal=True,
    )

    if selected != st.session_state.get("selected_category", "전체"):
        st.session_state["selected_category"] = selected
        st.session_state["category_page"] = 1
        st.rerun()

    if selected == "전체":
        filtered = base.copy()
        title = "전체 구분 정보"
    else:
        filtered = base[base["구분"] == selected].copy()
        title = f"{selected} 정보"

    page_size = 10
    total_rows = len(filtered)
    total_pages = max(1, (total_rows + page_size - 1) // page_size)
    if st.session_state["category_page"] > total_pages:
        st.session_state["category_page"] = total_pages
    if st.session_state["category_page"] < 1:
        st.session_state["category_page"] = 1
    cur = st.session_state["category_page"]

    components.html(
        detail_table_html(title, filtered, cur, page_size),
        height=table_height(filtered, cur, page_size) + 20,
        scrolling=False,
    )
    render_pagination("category_page", total_rows, page_size)

    csv_bytes = filtered[["게시일", "구분", "제목", "링크"]].to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
    st.download_button(
        "현재 구분 목록 CSV 다운로드",
        data=csv_bytes,
        file_name=f"mfds_category_{TODAY.strftime('%Y%m%d')}.csv",
        mime="text/csv",
    )


def main():
    st.set_page_config(page_title="MFDS Regulatory Dashboard", layout="wide")
    page_css()

    # 배포 후 브라우저 세션에 남은 이전 버전 status_message/수집결과가
    # 새 버전 확인을 방해하지 않도록 앱 버전이 바뀌면 상태를 초기화한다.
    if st.session_state.get("__app_version") != APP_VERSION:
        st.session_state["__app_version"] = APP_VERSION
        st.session_state.pop("status_message", None)
        st.session_state.pop("last_collect_report", None)

    for k in ["main_page", "category_page"]:
        if k not in st.session_state:
            st.session_state[k] = 1
    if "selected_category" not in st.session_state:
        st.session_state["selected_category"] = "전체"
    if "keyword" not in st.session_state:
        st.session_state["keyword"] = ""
    if "last_period_key" not in st.session_state:
        st.session_state["last_period_key"] = ""

    components.html(hero_html(), height=210)

    # 조회 조건은 입력값과 적용값을 분리한다.
    # 기간/검색어를 바꿔도 바로 재수집하지 않고, [조회]를 눌러야 DB 조회 조건에 반영된다.
    if "applied_keyword" not in st.session_state:
        st.session_state["applied_keyword"] = ""
    if "applied_period" not in st.session_state:
        st.session_state["applied_period"] = "최근 7일"
    if "applied_start_date" not in st.session_state:
        st.session_state["applied_start_date"] = None
    if "applied_end_date" not in st.session_state:
        st.session_state["applied_end_date"] = None
    if "status_message" not in st.session_state:
        st.session_state["status_message"] = ""

    st.markdown("<div style='height:10px'></div>", unsafe_allow_html=True)
    c1, c2, c3, c4, c5, spacer = st.columns([1.25, 0.9, 0.46, 0.72, 0.72, 1.35])
    with c1:
        input_keyword = st.text_input("검색", value=st.session_state.get("keyword", ""), placeholder="검색어를 입력하세요", label_visibility="collapsed", key="keyword_input")
    with c2:
        input_period = st.selectbox("기간", ["오늘", "최근 7일", "최근 14일", "직접 선택"], index=["오늘", "최근 7일", "최근 14일", "직접 선택"].index(st.session_state.get("period_input", "최근 7일")) if st.session_state.get("period_input", "최근 7일") in ["오늘", "최근 7일", "최근 14일", "직접 선택"] else 1, label_visibility="collapsed", key="period_input")
    with c3:
        query_clicked = st.button("조회", type="primary", use_container_width=True, help="선택한 기간과 검색어로 Supabase DB에 저장된 데이터만 조회합니다.")
    with c4:
        fast_collect_clicked = st.button("빠른수집", type="primary", use_container_width=True, help="각 식약처 게시판의 첫 페이지만 빠르게 확인하여 신규 항목을 Supabase DB에 저장합니다.")
    with c5:
        period_collect_clicked = st.button("기간수집", type="primary", use_container_width=True, help="선택한 기간 전체를 여러 페이지까지 확인하여 누락을 줄이고 Supabase DB에 저장합니다.")

    input_start_date = None
    input_end_date = None
    if input_period == "직접 선택":
        d1, d2, spacer2 = st.columns([0.18, 0.18, 0.64])
        with d1:
            input_start_date = st.date_input("시작일", value=st.session_state.get("start_date_input", TODAY - timedelta(days=14)), key="start_date_input")
        with d2:
            input_end_date = st.date_input("종료일", value=st.session_state.get("end_date_input", TODAY), key="end_date_input")
        if input_start_date > input_end_date:
            input_start_date, input_end_date = input_end_date, input_start_date
            st.warning("시작일이 종료일보다 늦어 자동으로 순서를 바꾸었습니다.")

    input_collect_start, input_collect_end = period_dates(input_period, input_start_date, input_end_date)

    def apply_current_query():
        st.session_state["keyword"] = input_keyword
        st.session_state["applied_keyword"] = input_keyword
        st.session_state["applied_period"] = input_period
        st.session_state["applied_start_date"] = input_start_date
        st.session_state["applied_end_date"] = input_end_date
        st.session_state["main_page"] = 1
        st.session_state["category_page"] = 1

    if query_clicked:
        apply_current_query()
        st.session_state["status_message"] = "조회 조건을 적용했습니다. Supabase DB에 저장된 데이터만 조회합니다."
        st.rerun()

    # DB 연결은 화면 구성 이후 수행한다.
    # 연결 실패 시 무한 로딩/빨간 Traceback 대신 점검 안내를 표시한다.
    try:
        init_db()
    except Exception as e:
        st.error("Supabase DB 연결에 실패했습니다. 앱은 배포되었지만 DATABASE_URL 또는 Supabase 연결 설정을 확인해야 합니다.")
        st.code(safe_db_error_message(e), language="text")
        st.info(
            "확인 순서: ① Streamlit Secrets의 DATABASE_URL이 실제 Supabase connection string인지 확인 "
            "② postgres.xxxxxx가 예시값이 아니라 실제 프로젝트 값인지 확인 "
            "③ [YOUR-PASSWORD]가 실제 DB 비밀번호로 교체되었는지 확인 "
            "④ Supabase Connect > Direct > Transaction pooler 문자열 사용 "
            "⑤ Secrets 저장 후 Reboot app"
        )
        st.stop()

    try:
        auto_collect = get_secret_bool("AUTO_COLLECT_ON_LOAD", False)
        if auto_collect and get_meta("last_auto_collect_date", "") != TODAY.isoformat():
            with st.spinner("최근 14일 기준 식약처 게시물을 자동 수집하여 DB에 누적 중입니다."):
                auto_collect_once_per_day(TODAY - timedelta(days=14), TODAY)

        if fast_collect_clicked:
            apply_current_query()
            with st.spinner(f"{input_collect_start} ~ {input_collect_end} 기간의 최신 게시물을 빠른수집 중입니다. 각 게시판 첫 페이지만 확인합니다."):
                m_ins, m_skip, m_total = collect_mfds_to_db(input_collect_start, input_collect_end, collect_mode="fast")
            st.session_state["status_message"] = f"{APP_VERSION} 빠른수집 완료: 신규 {m_ins}건, 중복 제외 {m_skip}건, 확인 {m_total}건. 아래 게시판별 진단표를 확인하세요."
            st.cache_data.clear()
            st.rerun()

        if period_collect_clicked:
            apply_current_query()
            with st.spinner(f"{input_collect_start} ~ {input_collect_end} 기간 전체를 수집 중입니다. 여러 페이지를 확인하므로 시간이 걸릴 수 있습니다."):
                m_ins, m_skip, m_total = collect_mfds_to_db(input_collect_start, input_collect_end, collect_mode="period")
            st.session_state["status_message"] = f"{APP_VERSION} 기간수집 완료: 신규 {m_ins}건, 중복 제외 {m_skip}건, 확인 {m_total}건. 아래 게시판별 진단표를 확인하세요."
            st.cache_data.clear()
            st.rerun()

        if st.session_state.get("status_message"):
            st.info(st.session_state["status_message"])

        render_collect_report()

        df = db_load_all()

    except Exception as e:
        st.error("DB 조회 또는 수집 처리 중 오류가 발생했습니다.")
        st.code(safe_db_error_message(e), language="text")
        st.stop()

    if df.empty:
        if is_supabase_mode():
            st.info("Supabase DB에 아직 저장된 데이터가 없습니다. 기간을 선택한 뒤 [기간수집]을 눌러 최초 데이터를 수집해 주세요.")
        else:
            st.warning("DATABASE_URL 또는 SUPABASE_DB_URL이 설정되지 않아 Local SQLite fallback으로 실행 중입니다.")

    period = st.session_state.get("applied_period", "최근 7일")
    start_date = st.session_state.get("applied_start_date", None)
    end_date = st.session_state.get("applied_end_date", None)
    st.session_state["keyword"] = st.session_state.get("applied_keyword", "")

    tab1, tab2 = st.tabs(["식약처 정보", "구분별 정보"])

    with tab1:
        render_main_list(df, period, start_date, end_date)

    with tab2:
        render_category_info_tab(df, period, start_date, end_date)

    st.caption(
        f"ⓘ 본 대시보드는 식약처 목록 페이지에서 제목·등록일·링크만 수집합니다. "
        f"DB 모드: {db_mode_label()} · 마지막 수집: {db_last_collected()}"
    )


if __name__ == "__main__":
    main()
