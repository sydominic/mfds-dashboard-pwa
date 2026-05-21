import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import * as cheerio from 'cheerio';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(SERVER_DIR, '..');

function loadRootEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const rows = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of rows) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
    console.log(`[env] loaded ${envPath}`);
  } catch (err) {
    console.warn(`[env] failed to load .env: ${err?.message || err}`);
  }
}

loadRootEnv();

const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const JSON_STORE_PATH = path.join(DATA_DIR, 'mfds_items_store.json');
const JSON_META_PATH = path.join(DATA_DIR, 'mfds_meta_store.json');

const API_VERSION = 'v19-date-filter-statefix';
const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8892);
const HOST = process.env.HOST || '0.0.0.0';
const RAW_DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '').trim();
const RAW_SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const RAW_SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const ALLOW_LOCAL_POSTGRES = String(process.env.ALLOW_LOCAL_POSTGRES || 'false').toLowerCase() === 'true';
const DATABASE_URL_STATUS = validateDatabaseUrl(RAW_DATABASE_URL, ALLOW_LOCAL_POSTGRES);
const DATABASE_URL = DATABASE_URL_STATUS.usable ? RAW_DATABASE_URL : '';
const SUPABASE_REST_STATUS = validateSupabaseRest(RAW_SUPABASE_URL, RAW_SUPABASE_KEY);
const USE_SUPABASE_REST = !DATABASE_URL && SUPABASE_REST_STATUS.usable;
const AUTO_COLLECT_ON_LOAD = String(process.env.AUTO_COLLECT_ON_LOAD || 'false').toLowerCase() === 'true';


const BOARD_ID_LABEL_MAP = {
  m_74: '공지',
  m_76: '공고',
  m_99: '보도자료',
  m_203: '법, 시행령, 시행규칙',
  m_211: '고시전문',
  m_212: '훈령전문',
  m_215: '예규전문',
  m_207: '제개정고시등',
  m_209: '입법/행정예고',
  m_1059: '공무원지침서',
  m_1060: '민원인안내서',
  m_218: '안내서/지침',
  m_220: '학술토론회',
  m_231: '전문홍보물'
};

const MFDS_SOURCES = [
  { board_id: 'm_74', url: 'https://www.mfds.go.kr/brd/m_74/list.do' },
  { board_id: 'm_76', url: 'https://www.mfds.go.kr/brd/m_76/list.do' },
  { board_id: 'm_99', url: 'https://www.mfds.go.kr/brd/m_99/list.do' },
  { board_id: 'm_203', url: 'https://www.mfds.go.kr/brd/m_203/list.do' },
  { board_id: 'm_211', url: 'https://www.mfds.go.kr/brd/m_211/list.do' },
  { board_id: 'm_212', url: 'https://www.mfds.go.kr/brd/m_212/list.do' },
  { board_id: 'm_215', url: 'https://www.mfds.go.kr/brd/m_215/list.do' },
  { board_id: 'm_207', url: 'https://www.mfds.go.kr/brd/m_207/list.do' },
  { board_id: 'm_209', url: 'https://www.mfds.go.kr/brd/m_209/list.do' },
  { board_id: 'm_1059', url: 'https://www.mfds.go.kr/brd/m_1059/list.do' },
  { board_id: 'm_1060', url: 'https://www.mfds.go.kr/brd/m_1060/list.do' },
  { board_id: 'm_218', url: 'https://www.mfds.go.kr/brd/m_218/list.do' },
  { board_id: 'm_220', url: 'https://www.mfds.go.kr/brd/m_220/list.do' },
  { board_id: 'm_231', url: 'https://www.mfds.go.kr/brd/m_231/list.do' }
];


function validateDatabaseUrl(rawUrl, allowLocalPostgres) {
  const value = String(rawUrl || '').trim();
  if (!value) return { usable: false, reason: 'DATABASE_URL not set. local-json or Supabase REST mode will be used.' };
  const lower = value.toLowerCase();
  if (lower.includes('your_password') || lower.includes('xxxxxx') || lower.includes('<') || lower.includes('>')) {
    return { usable: false, reason: 'DATABASE_URL still looks like a placeholder. local-json or Supabase REST mode will be used.' };
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return { usable: false, reason: 'DATABASE_URL is not a PostgreSQL connection string. local-json or Supabase REST mode will be used.' };
  }
  if (!allowLocalPostgres && (lower.includes('@localhost') || lower.includes('@127.0.0.1') || lower.includes('localhost:5432') || lower.includes('127.0.0.1:5432'))) {
    return { usable: false, reason: 'DATABASE_URL points to local PostgreSQL. Set ALLOW_LOCAL_POSTGRES=true only when local PostgreSQL is actually running; otherwise local-json or Supabase REST mode will be used.' };
  }
  return { usable: true, reason: 'DATABASE_URL accepted.' };
}

function validateSupabaseRest(rawUrl, rawKey) {
  const url = String(rawUrl || '').trim();
  const key = String(rawKey || '').trim();
  if (!url && !key) return { usable: false, reason: 'SUPABASE_URL/SUPABASE_SERVICE_KEY not set.' };
  if (!url || !key) return { usable: false, reason: 'SUPABASE_URL or Supabase key is missing.' };
  if (!/^https:\/\/[^\s]+\.supabase\.co/i.test(url) && !/^https?:\/\//i.test(url)) {
    return { usable: false, reason: 'SUPABASE_URL does not look like a URL.' };
  }
  if (key.length < 20 || key.toLowerCase().includes('your_')) {
    return { usable: false, reason: 'Supabase key looks empty or placeholder.' };
  }
  return { usable: true, reason: 'Supabase REST credentials accepted.' };
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: normalizeDbUrl(DATABASE_URL),
      ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

const supabaseRest = USE_SUPABASE_REST
  ? createClient(RAW_SUPABASE_URL, RAW_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws }
    })
  : null;

function dbMode() {
  if (pool) return 'postgres';
  if (supabaseRest) return 'supabase-rest';
  return 'local-json';
}

let dbReady = false;
let initError = null;

function normalizeDbUrl(url) {
  if (!url) return '';
  return url.startsWith('postgres://') ? url.replace('postgres://', 'postgresql://') : url;
}

function shouldUseSsl(url) {
  return Boolean(url && !url.includes('localhost') && !url.includes('127.0.0.1'));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(file, fallback) {
  ensureDataDir();
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

function norm(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function boardLabel(boardId) {
  return BOARD_ID_LABEL_MAP[String(boardId || '').trim()] || String(boardId || '').trim();
}

function sha256(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf-8').digest('hex');
}

function itemHash(site, category, itemDate, title, url) {
  return sha256(`${site || ''}|${category || ''}|${itemDate || ''}|${norm(title)}|${url || ''}`);
}

function toKstDateString(dateObj) {
  const kst = new Date(dateObj.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getTodayKst() {
  return toKstDateString(new Date());
}

function kstNowString() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('T', ' ').slice(0, 19);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareDate(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function periodRange(period, startDate, endDate) {
  const today = getTodayKst();
  // When the client sends an explicit date range, trust it for every period.
  // This prevents long-running Render/Node processes from using a stale server-start date.
  if (startDate || endDate) {
    const safeEnd = endDate || today;
    return { startDate: startDate || addDays(safeEnd, -7), endDate: safeEnd };
  }
  if (period === 'today') return { startDate: today, endDate: today };
  if (period === 'recent14') return { startDate: addDays(today, -14), endDate: today };
  if (period === 'custom') return { startDate: addDays(today, -7), endDate: today };
  return { startDate: addDays(today, -7), endDate: today };
}

function parseDateAny(textValue) {
  const t = norm(textValue);
  let m = t.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) {
    const yyyy = m[1];
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  m = t.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) {
    const yyyy = m[1];
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function addOrReplaceQueryParam(rawUrl, key, value) {
  const u = new URL(rawUrl);
  u.searchParams.set(key, String(value));
  return u.toString();
}

function mfdsPagedUrl(baseUrl, pageNo) {
  if (Number(pageNo) <= 1) return baseUrl;
  return addOrReplaceQueryParam(baseUrl, 'page', Number(pageNo));
}

function isBadTitle(title) {
  const t = norm(title);
  if (!t || t.length < 5) return true;
  const badExact = new Set(['로그인', '회원가입', '검색', '이전', '다음', '처음', '마지막', '더보기', '목록', '메뉴', '본문 바로가기', '전체 메뉴', 'RSS', '누리집 안내지도', '전체메뉴', '바로가기']);
  if (badExact.has(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (t.length > 220) return true;
  return false;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url, timeoutMs = 12000) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MFDSDashboard/NodeRender',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString('utf-8');
    } catch (err) {
      lastError = err;
      await delay(attempt * 500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function parseMfdsBoardPage(src, pageUrl, startDate, endDate) {
  const rows = [];
  const pageDates = [];
  const boardId = src.board_id;
  const category = boardLabel(boardId);

  try {
    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    let candidates = $('li').toArray();
    if (!candidates.length) candidates = $('tr').toArray();

    for (const el of candidates) {
      const txt = norm($(el).text());
      const d = parseDateAny(txt);
      if (!d) continue;
      pageDates.push(d);

      let titleAnchor = null;
      $(el).find('a').each((_, a) => {
        if (titleAnchor) return;
        const aText = norm($(a).text());
        const href = $(a).attr('href') || '';
        if (isBadTitle(aText)) return;
        if (['다운받기', '미리보기', '열기', '펼치기', '접기'].includes(aText)) return;
        if (href.includes('list.do') && ['list', '목록'].includes(aText.toLowerCase())) return;
        titleAnchor = a;
      });

      if (!titleAnchor) continue;
      const title = norm($(titleAnchor).text());
      const href = $(titleAnchor).attr('href') || pageUrl;
      const link = new URL(href, pageUrl).toString();

      if (compareDate(d, startDate) < 0 || compareDate(d, endDate) > 0) continue;
      rows.push({ site: '식약처', category, board_id: boardId, item_date: d, title, url: link });
    }

    return { rows, pageDates, error: null };
  } catch (err) {
    return { rows, pageDates, error: `${boardId} ${pageUrl}: ${err?.message || err}` };
  }
}

async function parseMfdsBoard(src, startDate, endDate, maxPages = 40) {
  const allRows = [];
  const errors = [];
  let previousPageSignature = null;
  let emptyCount = 0;

  for (let pageNo = 1; pageNo <= Number(maxPages); pageNo += 1) {
    const pageUrl = mfdsPagedUrl(src.url, pageNo);
    const { rows, pageDates, error } = await parseMfdsBoardPage(src, pageUrl, startDate, endDate);
    if (error) errors.push(error);

    const signature = rows.slice(0, 10).map(r => `${r.item_date}:${r.title}`).join('|');
    if (pageNo > 1 && signature && signature === previousPageSignature) break;
    if (signature) previousPageSignature = signature;

    if (rows.length) {
      allRows.push(...rows);
      emptyCount = 0;
    } else {
      emptyCount += 1;
    }

    if (pageDates.length) {
      const maxDate = pageDates.sort().at(-1);
      const minDate = pageDates.sort()[0];
      if (compareDate(maxDate, startDate) < 0) break;
      if (compareDate(minDate, startDate) < 0 && pageNo > 1) break;
    }

    if (pageNo > 1 && emptyCount >= 3) break;
    await delay(120);
  }

  const seen = new Set();
  const deduped = [];
  for (const r of allRows) {
    const key = itemHash(r.site, r.category, r.item_date, r.title, r.url);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  return { rows: deduped, errors };
}

async function initDb() {
  if (dbReady) return;
  if (!pool && !supabaseRest) {
    ensureDataDir();
    if (!fs.existsSync(JSON_STORE_PATH)) writeJsonFile(JSON_STORE_PATH, []);
    if (!fs.existsSync(JSON_META_PATH)) writeJsonFile(JSON_META_PATH, {});
    dbReady = true;
    return;
  }
  if (supabaseRest) {
    try {
      const { error } = await supabaseRest.from('items').select('item_key').limit(1);
      if (error) throw error;
      const { error: metaError } = await supabaseRest.from('meta').select('key').limit(1);
      if (metaError && !String(metaError.message || '').toLowerCase().includes('relation')) throw metaError;
      dbReady = true;
      return;
    } catch (err) {
      initError = err;
      throw err;
    }
  }
  try {
    await pool.query(`
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
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_items_date ON items(item_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_items_category_date ON items(category, item_date)');
    dbReady = true;
  } catch (err) {
    initError = err;
    throw err;
  }
}

async function dbLoadAll() {
  await initDb();
  if (!pool && !supabaseRest) return sortItemsByDateDesc(readJsonFile(JSON_STORE_PATH, []));
  if (supabaseRest) {
    const all = [];
    const pageSize = 1000;
    for (let from = 0; from < 50000; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await supabaseRest
        .from('items')
        .select('site, category, board_id, item_date, title, url, item_key, collected_at')
        .order('item_date', { ascending: false })
        .order('collected_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return sortItemsByDateDesc(all);
  }
  const result = await pool.query(`
    SELECT site, category, board_id, item_date, title, url, item_key, collected_at
    FROM items
    ORDER BY item_date DESC, id DESC
  `);
  return result.rows || [];
}

async function dbInsertItems(rows) {
  await initDb();
  if (!rows?.length) return { inserted: 0, skipped: 0 };
  const now = kstNowString();
  let inserted = 0;
  let skipped = 0;

  if (!pool && !supabaseRest) {
    const store = readJsonFile(JSON_STORE_PATH, []);
    const seen = new Set(store.map(x => x.item_key));
    for (const r of rows) {
      const itemKey = itemHash(r.site || '식약처', r.category || '', r.item_date || '', r.title || '', r.url || '');
      if (seen.has(itemKey)) {
        skipped += 1;
        continue;
      }
      seen.add(itemKey);
      store.push({ ...r, item_key: itemKey, collected_at: now });
      inserted += 1;
    }
    writeJsonFile(JSON_STORE_PATH, store);
    return { inserted, skipped };
  }

  if (supabaseRest) {
    const payload = rows.map(r => ({
      site: r.site || '식약처',
      category: r.category || '',
      board_id: r.board_id || '',
      item_date: r.item_date || '',
      title: r.title || '',
      url: r.url || '',
      item_key: itemHash(r.site || '식약처', r.category || '', r.item_date || '', r.title || '', r.url || ''),
      collected_at: now
    }));
    const existing = new Set();
    for (let i = 0; i < payload.length; i += 200) {
      const keys = payload.slice(i, i + 200).map(x => x.item_key);
      const { data, error } = await supabaseRest.from('items').select('item_key').in('item_key', keys);
      if (error) throw error;
      for (const row of data || []) existing.add(row.item_key);
    }
    const toInsert = payload.filter(x => !existing.has(x.item_key));
    skipped = payload.length - toInsert.length;
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { data, error } = await supabaseRest.from('items').insert(chunk).select('item_key');
      if (error) throw error;
      inserted += (data || []).length;
    }
    return { inserted, skipped };
  }

  const client = await pool.connect();
  try {
    for (const r of rows) {
      const params = [
        r.site || '식약처',
        r.category || '',
        r.board_id || '',
        r.item_date || '',
        r.title || '',
        r.url || '',
        itemHash(r.site || '식약처', r.category || '', r.item_date || '', r.title || '', r.url || ''),
        now
      ];
      const result = await client.query(
        `INSERT INTO items(site, category, board_id, item_date, title, url, item_key, collected_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (item_key) DO NOTHING
         RETURNING id`,
        params
      );
      if (result.rowCount === 1) inserted += 1;
      else skipped += 1;
    }
  } finally {
    client.release();
  }
  return { inserted, skipped };
}

async function dbLastCollected() {
  await initDb();
  if (!pool && !supabaseRest) {
    const store = readJsonFile(JSON_STORE_PATH, []);
    const vals = store.map(x => x.collected_at).filter(Boolean).sort();
    return vals.at(-1) || '-';
  }
  if (supabaseRest) {
    const { data, error } = await supabaseRest.from('items').select('collected_at').not('collected_at', 'is', null).order('collected_at', { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0]?.collected_at || '-';
  }
  const result = await pool.query('SELECT MAX(collected_at) AS last_collected FROM items');
  return result.rows?.[0]?.last_collected || '-';
}

async function getMeta(key, defaultValue = '') {
  await initDb();
  if (!pool && !supabaseRest) {
    const meta = readJsonFile(JSON_META_PATH, {});
    return meta[key] || defaultValue;
  }
  if (supabaseRest) {
    const { data, error } = await supabaseRest.from('meta').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data?.value || defaultValue;
  }
  const result = await pool.query('SELECT value FROM meta WHERE key = $1', [key]);
  return result.rows?.[0]?.value || defaultValue;
}

async function setMeta(key, value) {
  await initDb();
  if (!pool && !supabaseRest) {
    const meta = readJsonFile(JSON_META_PATH, {});
    meta[key] = value;
    writeJsonFile(JSON_META_PATH, meta);
    return;
  }
  if (supabaseRest) {
    const { error } = await supabaseRest.from('meta').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
    return;
  }
  await pool.query(
    `INSERT INTO meta(key, value) VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

function filterItems(items, { startDate, endDate, q = '', category = '전체' }) {
  const keyword = norm(q).toLowerCase();
  return (items || []).filter(item => {
    const d = item.item_date || '';
    if (startDate && compareDate(d, startDate) < 0) return false;
    if (endDate && compareDate(d, endDate) > 0) return false;
    if (category && category !== '전체' && item.category !== category) return false;
    if (keyword) {
      const hay = `${item.title || ''} ${item.category || ''} ${item.board_id || ''}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

function sortItemsByDateDesc(items) {
  return [...(items || [])].sort((a, b) => {
    const dateCmp = String(b.item_date || '').localeCompare(String(a.item_date || ''));
    if (dateCmp) return dateCmp;
    const collectCmp = String(b.collected_at || '').localeCompare(String(a.collected_at || ''));
    if (collectCmp) return collectCmp;
    return String(a.title || '').localeCompare(String(b.title || ''), 'ko');
  });
}

function summarize(items) {
  const today = getTodayKst();
  const recent7 = addDays(today, -7);
  const recent14 = addDays(today, -14);
  const categories = new Map();
  for (const item of items || []) {
    const c = item.category || '기타';
    categories.set(c, (categories.get(c) || 0) + 1);
  }
  const categoryRows = [...categories.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'ko'));
  return {
    total: items.length,
    today: items.filter(x => x.item_date === today).length,
    recent7: items.filter(x => compareDate(x.item_date, recent7) >= 0 && compareDate(x.item_date, today) <= 0).length,
    recent14: items.filter(x => compareDate(x.item_date, recent14) >= 0 && compareDate(x.item_date, today) <= 0).length,
    categoryRows
  };
}

async function collectMfdsToDb(startDate, endDate, collectMode = 'period') {
  const days = Math.max(1, Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  const maxPages = collectMode === 'fast' ? 1 : days <= 31 ? 10 : days <= 180 ? 25 : 60;
  const rows = [];
  const errors = [];
  const boardResults = [];

  for (const src of MFDS_SOURCES) {
    const result = await parseMfdsBoard(src, startDate, endDate, maxPages);
    rows.push(...result.rows);
    errors.push(...result.errors);
    boardResults.push({ board_id: src.board_id, category: boardLabel(src.board_id), count: result.rows.length, errors: result.errors.slice(0, 2) });
    await delay(150);
  }

  const { inserted, skipped } = await dbInsertItems(rows);
  await setMeta('last_collect_range', `${startDate}~${endDate}`);
  await setMeta('last_collect_mode', collectMode);
  return { inserted, skipped, checked: rows.length, boardResults, errors: errors.slice(0, 20) };
}

function parseQueryRange(req) {
  const { period = 'recent7', startDate, endDate } = req.query || {};
  return periodRange(period, startDate, endDate);
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  // Keep health lightweight. The local launcher should verify that the server process is alive,
  // not block forever because PostgreSQL is not configured yet.
  const mode = dbMode();
  res.json({
    ok: true,
    service: 'mfds-regulatory-pwa-api',
    apiVersion: API_VERSION,
    dbMode: mode,
    databaseConfigured: Boolean(DATABASE_URL || USE_SUPABASE_REST),
    databaseUrlStatus: DATABASE_URL_STATUS.reason,
    supabaseRestConfigured: Boolean(USE_SUPABASE_REST),
    supabaseRestStatus: SUPABASE_REST_STATUS.reason,
    dbReady,
    initError: initError ? String(initError?.message || initError).slice(0, 500) : null,
    port: PORT,
    host: HOST,
    today: getTodayKst(),
    sources: MFDS_SOURCES.length
  });
});

app.get('/api/options', async (_req, res, next) => {
  try {
    const items = await dbLoadAll();
    const categories = ['전체', ...Object.values(BOARD_ID_LABEL_MAP).filter(c => items.some(x => x.category === c))];
    res.json({ categories, boards: MFDS_SOURCES.map(x => ({ board_id: x.board_id, category: boardLabel(x.board_id), url: x.url })) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const range = parseQueryRange(req);
    const all = await dbLoadAll();
    const filtered = sortItemsByDateDesc(filterItems(all, { ...range, q: req.query.q || '', category: req.query.category || '전체' }));
    const recent = filtered.slice(0, 8);
    res.json({ range, stats: summarize(all), filteredStats: summarize(filtered), recent, lastCollected: await dbLastCollected(), totalStored: all.length });
  } catch (err) {
    next(err);
  }
});

app.get('/api/items', async (req, res, next) => {
  try {
    const range = parseQueryRange(req);
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 10)));
    const all = await dbLoadAll();
    const filtered = sortItemsByDateDesc(filterItems(all, { ...range, q: req.query.q || '', category: req.query.category || '전체' }));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const items = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    res.json({ range, total, totalPages, page: currentPage, pageSize, items, lastCollected: await dbLastCollected() });
  } catch (err) {
    next(err);
  }
});

app.post('/api/collect', async (req, res, next) => {
  try {
    const body = req.body || {};
    const mode = body.mode === 'fast' ? 'fast' : 'period';
    const today = getTodayKst();
    const startDate = body.startDate || addDays(today, -7);
    const endDate = body.endDate || today;
    const result = await collectMfdsToDb(startDate, endDate, mode);
    res.json({ ok: true, mode, startDate, endDate, ...result, lastCollected: await dbLastCollected() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/boards', (_req, res) => {
  res.json({ boards: MFDS_SOURCES.map(x => ({ board_id: x.board_id, category: boardLabel(x.board_id), url: x.url })) });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '5m' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error('[api error]', err);
  res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 1000) });
});

app.listen(PORT, HOST, async () => {
  console.log(`MFDS Regulatory PWA API listening on http://${HOST}:${PORT}`);
  console.log(`API version: ${API_VERSION}`);
  console.log(`Database configured: ${Boolean(DATABASE_URL || USE_SUPABASE_REST)} (${dbMode()})`);
  console.log(`DATABASE_URL status: ${DATABASE_URL_STATUS.reason}`);
  console.log(`Supabase REST status: ${SUPABASE_REST_STATUS.reason}`);
  console.log(`Client dist serving: ${CLIENT_DIST}`);
  try {
    await initDb();
    const startupToday = getTodayKst();
    if (AUTO_COLLECT_ON_LOAD && (await getMeta('last_auto_collect_date', '')) !== startupToday) {
      console.log('Auto collect enabled. Collecting recent 14 days...');
      await collectMfdsToDb(addDays(startupToday, -14), startupToday, 'fast');
      await setMeta('last_auto_collect_date', startupToday);
    }
  } catch (err) {
    console.error('[startup db init warning]', err);
  }
});
