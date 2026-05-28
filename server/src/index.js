import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns';
import { execFile } from 'node:child_process';
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

const API_VERSION = 'v24-board-by-board-json-collect';
const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8892);
const HOST = process.env.HOST || '0.0.0.0';
const COLLECT_FETCH_TIMEOUT_MS = Number(process.env.COLLECT_FETCH_TIMEOUT_MS || 12000);
const DIAGNOSTIC_FETCH_TIMEOUT_MS = Number(process.env.DIAGNOSTIC_FETCH_TIMEOUT_MS || 12000);
const PREFLIGHT_FETCH_TIMEOUT_MS = Number(process.env.PREFLIGHT_FETCH_TIMEOUT_MS || 10000);
const COLLECT_GLOBAL_TIMEOUT_MS = Number(process.env.COLLECT_GLOBAL_TIMEOUT_MS || 90000);
const COLLECT_METHOD = String(process.env.COLLECT_METHOD || 'auto').trim();
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

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 MFDSDashboard/NodeRender',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Connection': 'close'
};

const LAST_FETCH_INFO = new Map();

function compactFetchError(err) {
  const parts = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value) !== '') parts.push(`${label}=${String(value)}`);
  };

  add('name', err?.name);
  add('message', err?.message || err);
  add('code', err?.code);
  add('errno', err?.errno);
  add('syscall', err?.syscall);
  add('hostname', err?.hostname);
  add('host', err?.host);
  add('address', err?.address);
  add('port', err?.port);

  const cause = err?.cause;
  if (cause) {
    add('cause.name', cause?.name);
    add('cause.message', cause?.message);
    add('cause.code', cause?.code);
    add('cause.errno', cause?.errno);
    add('cause.syscall', cause?.syscall);
    add('cause.hostname', cause?.hostname);
    add('cause.address', cause?.address);
    add('cause.port', cause?.port);
  }

  return parts.join(', ').slice(0, 1200);
}

async function fetchHtmlWithNodeFetch(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: FETCH_HEADERS
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('utf-8');
  } finally {
    clearTimeout(timer);
  }
}

function httpsRequestOnce(url, timeoutMs = 12000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const target = new URL(url);

    const req = https.request(
      target,
      {
        method: 'GET',
        headers: FETCH_HEADERS,
        timeout: timeoutMs,
        family: 4,
        lookup: (hostname, options, callback) => {
          dns.lookup(hostname, { ...options, family: 4 }, callback);
        }
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
          res.resume();
          const nextUrl = new URL(location, url).toString();
          httpsRequestOnce(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTPS HTTP ${status}`));
          return;
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          if (!settled) {
            settled = true;
            resolve(Buffer.concat(chunks).toString('utf-8'));
          }
        });
      }
    );

    req.on('timeout', () => {
      if (!settled) {
        settled = true;
        req.destroy(new Error(`https timeout ${timeoutMs}ms`));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.end();
  });
}

function fetchHtmlWithCurl(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-L',
      '--ipv4',
      '--compressed',
      '--silent',
      '--show-error',
      '--max-time',
      String(Math.max(3, Math.ceil(timeoutMs / 1000))),
      '-A',
      FETCH_HEADERS['User-Agent'],
      '-H',
      `Accept-Language: ${FETCH_HEADERS['Accept-Language']}`,
      '-H',
      'Cache-Control: no-cache',
      url
    ];

    execFile('curl', args, { timeout: timeoutMs + 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = [err.message, stderr].filter(Boolean).join(' / ');
        const e = new Error(`curl failed: ${detail}`);
        e.code = err.code;
        reject(e);
        return;
      }
      resolve(stdout);
    });
  });
}

async function runFetchMethod(url, method, timeoutMs) {
  if (method === 'node-fetch') return fetchHtmlWithNodeFetch(url, timeoutMs);
  if (method === 'https-ipv4') return httpsRequestOnce(url, timeoutMs);
  if (method === 'curl-ipv4') return fetchHtmlWithCurl(url, timeoutMs);
  throw new Error(`unknown fetch method: ${method}`);
}

async function fetchHtml(url, options = {}) {
  const {
    timeoutMs = COLLECT_FETCH_TIMEOUT_MS,
    mode = 'collect',
    methods = mode === 'diagnostic' ? ['node-fetch', 'https-ipv4', 'curl-ipv4'] : ['node-fetch']
  } = options;

  const errors = [];

  for (const method of methods) {
    try {
      const html = await runFetchMethod(url, method, timeoutMs);
      const info = {
        ok: true,
        method,
        htmlLength: html ? html.length : 0,
        error: '',
        errors
      };
      LAST_FETCH_INFO.set(url, info);
      console.log(`[mfds-fetch] OK mode=${mode} method=${method} ${url} html=${info.htmlLength}`);
      return html;
    } catch (err) {
      const detail = `${method}: ${compactFetchError(err)}`;
      errors.push(detail);
      console.warn(`[mfds-fetch-error] mode=${mode} ${url} ${detail}`);
      if (mode !== 'diagnostic') break;
      await delay(250);
    }
  }

  const message = `fetch failed: ${errors.join(' | ')}`;
  LAST_FETCH_INFO.set(url, {
    ok: false,
    method: 'none',
    htmlLength: 0,
    error: message.slice(0, 1200),
    errors
  });
  throw new Error(message);
}

async function runFetchDiagnostics(url, timeoutMs = DIAGNOSTIC_FETCH_TIMEOUT_MS) {
  const results = [];
  for (const method of ['node-fetch', 'https-ipv4', 'curl-ipv4']) {
    const started = Date.now();
    try {
      const html = await runFetchMethod(url, method, timeoutMs);
      results.push({
        method,
        ok: true,
        elapsedMs: Date.now() - started,
        htmlLength: html ? html.length : 0,
        lineCount: html ? html.split(/\r?\n/).length : 0,
        totalMarker: /전체\s*[0-9,]+\s*건/.test(html || ''),
        error: ''
      });
    } catch (err) {
      results.push({
        method,
        ok: false,
        elapsedMs: Date.now() - started,
        htmlLength: 0,
        lineCount: 0,
        totalMarker: false,
        error: compactFetchError(err)
      });
    }
  }
  return results;
}


async function chooseCollectFetchMethod() {
  const configured = String(COLLECT_METHOD || 'auto').trim();
  const allowed = ['node-fetch', 'https-ipv4', 'curl-ipv4'];

  if (allowed.includes(configured)) {
    return {
      method: configured,
      configured: true,
      url: '',
      results: [{
        method: configured,
        ok: true,
        elapsedMs: 0,
        htmlLength: 0,
        lineCount: 0,
        totalMarker: false,
        error: 'COLLECT_METHOD 환경변수로 지정됨'
      }]
    };
  }

  const src = MFDS_SOURCES.find(x => x.board_id === 'm_99') || MFDS_SOURCES[0];
  const pageUrl = mfdsPagedUrl(src.url, 1);
  const results = [];

  for (const method of allowed) {
    const started = Date.now();
    try {
      const html = await runFetchMethod(pageUrl, method, PREFLIGHT_FETCH_TIMEOUT_MS);
      const result = {
        method,
        ok: true,
        elapsedMs: Date.now() - started,
        htmlLength: html ? html.length : 0,
        lineCount: html ? html.split(/\r?\n/).length : 0,
        totalMarker: /전체\s*[0-9,]+\s*건/.test(html || ''),
        error: ''
      };
      results.push(result);

      // HTML을 실제로 받았고, 식약처 목록 표식이 있으면 이 방식을 수집 기본값으로 사용한다.
      if (result.htmlLength > 0 && result.totalMarker) {
        console.log(`[mfds-preflight] selected=${method} html=${result.htmlLength} lines=${result.lineCount}`);
        return { method, configured: false, url: pageUrl, results };
      }

      // 전체건 표식은 없더라도 HTML이 충분히 크면 차선으로 사용한다.
      if (result.htmlLength > 3000) {
        console.log(`[mfds-preflight] selected=${method} without-total-marker html=${result.htmlLength} lines=${result.lineCount}`);
        return { method, configured: false, url: pageUrl, results };
      }
    } catch (err) {
      results.push({
        method,
        ok: false,
        elapsedMs: Date.now() - started,
        htmlLength: 0,
        lineCount: 0,
        totalMarker: false,
        error: compactFetchError(err)
      });
      console.warn(`[mfds-preflight-error] ${method}: ${compactFetchError(err)}`);
    }
  }

  return { method: null, configured: false, url: pageUrl, results };
}


function cleanMfdsTitle(title) {
  return norm(title).replace(/새로운게시물/g, '').replace(/\s+/g, ' ').trim();
}

function isPureDateLine(line) {
  const t = norm(line);
  return /^20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(t);
}

function isValidMfdsTitle(title) {
  const t = cleanMfdsTitle(title);
  if (isBadTitle(t)) return false;
  if (isPureDateLine(t)) return false;
  if (/^\d{1,7}$/.test(t)) return false;
  if (/^조회수\s*\|?\s*\d+/i.test(t)) return false;
  if (/^담당부서\s*\|?/i.test(t)) return false;
  if (/^(미리보기|다운받기|펼치기|접기|닫기|열기)$/.test(t)) return false;
  if (/(미리보기|다운받기|첨부파일|파일첨부|부산청인스타그램|검색어 검색|특수문자 검색 불가|등록번호입력예시)/.test(t)) return false;
  if (/\.(pdf|hwpx?|hwp|docx?|xlsx?|zip|png|jpe?g)$/i.test(t)) return false;
  if (/^(전체|공통|식품|의약품|의료기기|바이오|화장품|한약|위생용품|백신치료제|의약외품)$/.test(t)) return false;
  if (t.length < 5 || t.length > 260) return false;
  return true;
}

function extractSeqFromUrl(rawUrl) {
  const m = String(rawUrl || '').match(/(?:seq|nttId|articleNo|itm_seq_1)=([0-9]+)/);
  return m ? m[1] : '';
}

function normalizeItemUrl(baseUrl, href) {
  try {
    return new URL(href || baseUrl, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function makeViewUrlFromSeq(pageUrl, seq) {
  try {
    const u = new URL(pageUrl);
    const params = new URLSearchParams(u.search);
    params.set('seq', seq);
    return `${u.origin}${u.pathname.replace(/list\.do$/, 'view.do')}?${params.toString()}`;
  } catch {
    return pageUrl;
  }
}

function buildAnchorIndex($, pageUrl) {
  const anchors = [];
  $('a').each((_, a) => {
    const rawText = $(a).text();
    const title = cleanMfdsTitle(rawText);
    if (!isValidMfdsTitle(title)) return;

    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    let isView = /view\.do|seq=|itm_seq|nttId|articleNo/i.test(href);
    let seq = extractSeqFromUrl(href);

    if (!isView && onclick) {
      const m = onclick.match(/(?:seq|goView|view)\D+([0-9]{3,})/i);
      if (m) {
        seq = m[1];
        isView = true;
      }
    }

    if (!isView) return;
    const link = seq && (!href || /^javascript:/i.test(href)) ? makeViewUrlFromSeq(pageUrl, seq) : normalizeItemUrl(pageUrl, href);
    anchors.push({ title, link, seq });
  });

  const exact = new Map();
  const normalized = new Map();
  for (const a of anchors.sort((x, y) => y.title.length - x.title.length)) {
    if (!exact.has(a.title)) exact.set(a.title, a.link);
    const key = a.title.replace(/\s+/g, '').toLowerCase();
    if (!normalized.has(key)) normalized.set(key, a.link);
  }
  return { anchors, exact, normalized };
}

function findLinkForTitle(title, anchorIndex, pageUrl) {
  const t = cleanMfdsTitle(title);
  if (anchorIndex.exact.has(t)) return anchorIndex.exact.get(t);
  const key = t.replace(/\s+/g, '').toLowerCase();
  if (anchorIndex.normalized.has(key)) return anchorIndex.normalized.get(key);

  for (const a of anchorIndex.anchors) {
    const ak = a.title.replace(/\s+/g, '').toLowerCase();
    if (key && (ak.includes(key) || key.includes(ak))) return a.link;
  }
  return pageUrl;
}

function pushRow(rows, seen, row, parser) {
  const seq = extractSeqFromUrl(row.url);
  const key = seq || `${row.board_id}|${row.item_date}|${cleanMfdsTitle(row.title)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  rows.push({ ...row, title: cleanMfdsTitle(row.title), _parser: parser });
  return true;
}

function parseMfdsRowsByAnchorBlock($, pageUrl, startDate, endDate, boardId, category) {
  const rows = [];
  const seen = new Set();
  const pageDates = [];

  $('a').each((_, a) => {
    const title = cleanMfdsTitle($(a).text());
    if (!isValidMfdsTitle(title)) return;
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    const looksView = /view\.do|seq=|itm_seq|nttId|articleNo/i.test(href) || /(?:seq|goView|view)\D+[0-9]{3,}/i.test(onclick);
    if (!looksView) return;

    let block = $(a).closest('li, tr, div, dl, article, section');
    let txt = norm(block.text());
    let d = parseDateAny(txt);

    // 실제 목록 구조에서 날짜가 가까운 상위 block에 있을 수 있어 몇 단계 위로 올려본다.
    let parent = block.parent();
    for (let depth = 0; !d && depth < 4 && parent?.length; depth += 1) {
      const pt = norm(parent.text());
      const dates = [...pt.matchAll(/20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g)].map(x => parseDateAny(x[0])).filter(Boolean);
      // 너무 큰 본문 전체는 피하고, 제목 포함 + 날짜 포함일 때만 사용
      if (pt.includes(title) && dates.length && pt.length < 6000) d = dates[0];
      parent = parent.parent();
    }

    if (!d) return;
    pageDates.push(d);
    if (compareDate(d, startDate) < 0 || compareDate(d, endDate) > 0) return;

    let seq = extractSeqFromUrl(href);
    if (!seq && onclick) {
      const m = onclick.match(/(?:seq|goView|view)\D+([0-9]{3,})/i);
      if (m) seq = m[1];
    }
    const link = seq && (!href || /^javascript:/i.test(href)) ? makeViewUrlFromSeq(pageUrl, seq) : normalizeItemUrl(pageUrl, href || pageUrl);
    pushRow(rows, seen, { site: '식약처', category, board_id: boardId, item_date: d, title, url: link }, 'anchor');
  });

  return { rows, pageDates };
}

function parseMfdsRowsByDateBack($, pageUrl, startDate, endDate, boardId, category) {
  const rows = [];
  const seen = new Set();
  const pageDates = [];
  const anchorIndex = buildAnchorIndex($, pageUrl);
  const lines = $('body').text().split(/\r?\n/).map(x => norm(x)).filter(Boolean);

  function isNoiseLine(line) {
    const t = cleanMfdsTitle(line);
    if (!t) return true;
    if (isPureDateLine(t)) return true;
    if (/^\d{1,7}$/.test(t)) return true;
    if (/^조회수\s*\|?\s*\d+/i.test(t)) return true;
    if (/^담당부서\s*\|?/i.test(t)) return true;
    if (/^(새로운게시물|미리보기|다운받기|펼치기|접기|닫기|열기)$/.test(t)) return true;
    if (/(미리보기|다운받기|등록번호입력예시|특수문자 검색 불가|검색어 검색)/.test(t)) return true;
    if (/\.(pdf|hwpx?|hwp|docx?|xlsx?|zip|png|jpe?g)$/i.test(t)) return true;
    if (/^(전체|공통|식품|의약품|의료기기|바이오|화장품|한약|위생용품|백신치료제|의약외품)$/.test(t)) return true;
    return false;
  }

  let startIdx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/전체\s*[0-9,]+\s*건/.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }

  function isEndLine(line) {
    return /^(첫 페이지|이전 페이지|다음 페이지|마지막 페이지|개인정보처리방침|저작권정책|TOP)$/.test(line) || /Copyright|종합상담센터/.test(line);
  }

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    if (isEndLine(line)) break;
    if (!isPureDateLine(line)) continue;

    const d = parseDateAny(line);
    if (!d) continue;
    pageDates.push(d);
    if (compareDate(d, startDate) < 0 || compareDate(d, endDate) > 0) continue;

    const scanStart = Math.max(startIdx, i - 45);
    let title = '';

    // view anchor의 제목을 우선 매칭한다.
    for (let j = i - 1; j >= scanStart; j -= 1) {
      const cand = cleanMfdsTitle(lines[j]);
      if (isNoiseLine(cand)) continue;
      if (anchorIndex.exact.has(cand) && isValidMfdsTitle(cand)) {
        title = cand;
        break;
      }
    }

    if (!title) {
      for (let j = i - 1; j >= scanStart; j -= 1) {
        const cand = cleanMfdsTitle(lines[j]);
        if (isNoiseLine(cand)) continue;
        if (isValidMfdsTitle(cand)) {
          title = cand;
          break;
        }
      }
    }

    if (!title) continue;
    const link = findLinkForTitle(title, anchorIndex, pageUrl);
    pushRow(rows, seen, { site: '식약처', category, board_id: boardId, item_date: d, title, url: link }, 'dateback');
  }

  return { rows, pageDates, lineCount: lines.length, totalMarker: lines.some(x => /전체\s*[0-9,]+\s*건/.test(x)) };
}

async function parseMfdsBoardPage(src, pageUrl, startDate, endDate, fetchOptions = {}) {
  const rows = [];
  const pageDates = [];
  const boardId = src.board_id;
  const category = boardLabel(boardId);
  const diagnostics = {
    board_id: boardId,
    category,
    url: pageUrl,
    htmlLength: 0,
    lineCount: 0,
    totalMarker: false,
    anchorCount: 0,
    anchorRows: 0,
    datebackRows: 0,
    dedupedRows: 0,
    latestDateOnPage: '',
    error: null,
    fetchMethod: '',
    fetchErrorDetail: ''
  };

  try {
    const selectedMethod = fetchOptions.method || 'node-fetch';
    const html = await fetchHtml(pageUrl, { mode: 'collect', timeoutMs: fetchOptions.timeoutMs || COLLECT_FETCH_TIMEOUT_MS, methods: [selectedMethod] });
    const fetchInfo = LAST_FETCH_INFO.get(pageUrl) || {};
    diagnostics.fetchMethod = fetchInfo.method || '';
    diagnostics.fetchErrorDetail = fetchInfo.error || '';
    diagnostics.htmlLength = html.length;
    const $ = cheerio.load(html);
    diagnostics.anchorCount = $('a').length;

    const anchorParsed = parseMfdsRowsByAnchorBlock($, pageUrl, startDate, endDate, boardId, category);
    const dateBackParsed = parseMfdsRowsByDateBack($, pageUrl, startDate, endDate, boardId, category);

    pageDates.push(...anchorParsed.pageDates, ...dateBackParsed.pageDates);
    diagnostics.lineCount = dateBackParsed.lineCount || 0;
    diagnostics.totalMarker = Boolean(dateBackParsed.totalMarker);
    diagnostics.anchorRows = anchorParsed.rows.length;
    diagnostics.datebackRows = dateBackParsed.rows.length;

    const seen = new Set();
    for (const r of [...anchorParsed.rows, ...dateBackParsed.rows]) {
      pushRow(rows, seen, r, r._parser || 'deduped');
    }

    diagnostics.dedupedRows = rows.length;
    diagnostics.latestDateOnPage = pageDates.length ? [...pageDates].sort().at(-1) : '';
    console.log(`[mfds-parse] ${boardId} ${category} fetch=${diagnostics.fetchMethod || '-'} html=${diagnostics.htmlLength} lines=${diagnostics.lineCount} total=${diagnostics.totalMarker ? 'Y' : 'N'} anchors=${diagnostics.anchorRows} dateback=${diagnostics.datebackRows} deduped=${diagnostics.dedupedRows} latest=${diagnostics.latestDateOnPage || '-'}`);

    return { rows: rows.map(({ _parser, ...r }) => r), pageDates, error: null, diagnostics };
  } catch (err) {
    const fetchInfo = LAST_FETCH_INFO.get(pageUrl) || {};
    diagnostics.fetchMethod = fetchInfo.method || 'none';
    diagnostics.fetchErrorDetail = fetchInfo.error || compactFetchError(err);
    diagnostics.error = err?.message || String(err);
    console.warn(`[mfds-parse-error] ${boardId} ${pageUrl}: ${diagnostics.error}`);
    return { rows, pageDates, error: `${boardId} ${pageUrl}: ${diagnostics.error}`, diagnostics };
  }
}

async function parseMfdsBoard(src, startDate, endDate, maxPages = 40, fetchOptions = {}) {
  const allRows = [];
  const errors = [];
  const pageDiagnostics = [];
  let previousPageSignature = null;
  let emptyCount = 0;

  for (let pageNo = 1; pageNo <= Number(maxPages); pageNo += 1) {
    const pageUrl = mfdsPagedUrl(src.url, pageNo);
    const { rows, pageDates, error, diagnostics } = await parseMfdsBoardPage(src, pageUrl, startDate, endDate, fetchOptions);
    if (diagnostics) pageDiagnostics.push({ pageNo, ...diagnostics });
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
      const sortedDates = [...pageDates].sort();
      const maxDate = sortedDates.at(-1);
      const minDate = sortedDates[0];
      if (compareDate(maxDate, startDate) < 0) break;
      if (compareDate(minDate, startDate) < 0 && pageNo > 1) break;
    }

    if (pageNo > 1 && emptyCount >= 3) break;
    await delay(120);
  }

  const seen = new Set();
  const deduped = [];
  for (const r of allRows) {
    const seq = extractSeqFromUrl(r.url);
    const key = seq || itemHash(r.site, r.category, r.item_date, r.title, r.url);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  const latestDate = deduped.length ? deduped.map(r => r.item_date).sort().at(-1) : '';
  const latestPageDate = pageDiagnostics.map(x => x.latestDateOnPage).filter(Boolean).sort().at(-1) || '';
  return { rows: deduped, errors, diagnostics: { pages: pageDiagnostics, latestDate, latestPageDate } };
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
  const startedAt = Date.now();
  const days = Math.max(1, Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);

  // v23: 실제 수집 전에 m_99 1페이지로 Render에서 성공하는 fetch 방식을 먼저 고른다.
  // 목적은 timeout 메시지를 숨기는 것이 아니라 HTML > 0, 전체건=Y가 되는 수집 경로를 확정하는 것이다.
  const preflight = await chooseCollectFetchMethod();
  const selectedFetchMethod = preflight.method;

  const maxPages = collectMode === 'fast' ? 1 : days <= 31 ? 5 : days <= 180 ? 10 : 15;
  const errors = [];
  const boardResults = [];
  let inserted = 0;
  let skipped = 0;
  let checked = 0;
  let stoppedByGlobalTimeout = false;

  boardResults.push({
    board_id: 'preflight',
    category: '연결사전진단',
    checked: 0,
    inserted: 0,
    skipped: 0,
    latestDate: '',
    latestPageDate: '',
    fetchMethod: selectedFetchMethod || 'none',
    fetchErrorDetail: selectedFetchMethod
      ? `selected ${selectedFetchMethod}; ${preflight.results.map(r => `${r.method}:${r.ok ? 'OK' : 'FAIL'}:${r.elapsedMs}ms:${r.htmlLength}`).join(' / ')}`
      : `no fetch method succeeded; ${preflight.results.map(r => `${r.method}:${r.error || 'failed'}`).join(' / ')}`,
    htmlLength: preflight.results.find(r => r.method === selectedFetchMethod)?.htmlLength || 0,
    lineCount: preflight.results.find(r => r.method === selectedFetchMethod)?.lineCount || 0,
    totalMarker: preflight.results.find(r => r.method === selectedFetchMethod)?.totalMarker ? 'Y' : 'N',
    anchorRows: 0,
    datebackRows: 0,
    dedupedRows: 0,
    error: selectedFetchMethod ? '' : '식약처 HTML을 받을 수 있는 fetch 방식이 없습니다.'
  });

  if (!selectedFetchMethod) {
    return {
      inserted,
      skipped,
      checked,
      boardResults,
      errors: ['preflight failed: no fetch method succeeded'],
      stoppedByGlobalTimeout: false,
      elapsedMs: Date.now() - startedAt,
      apiVersion: API_VERSION,
      selectedFetchMethod: null,
      preflight
    };
  }

  for (const src of MFDS_SOURCES) {
    if (Date.now() - startedAt > COLLECT_GLOBAL_TIMEOUT_MS) {
      stoppedByGlobalTimeout = true;
      boardResults.push({
        board_id: src.board_id,
        category: boardLabel(src.board_id),
        checked: 0,
        inserted: 0,
        skipped: 0,
        latestDate: '',
        latestPageDate: '',
        fetchMethod: 'skipped',
        fetchErrorDetail: `global timeout ${COLLECT_GLOBAL_TIMEOUT_MS}ms reached before this board`,
        htmlLength: 0,
        lineCount: 0,
        totalMarker: 'N',
        anchorRows: 0,
        datebackRows: 0,
        dedupedRows: 0,
        error: `global timeout ${COLLECT_GLOBAL_TIMEOUT_MS}ms reached`
      });
      continue;
    }

    try {
      const result = await parseMfdsBoard(src, startDate, endDate, maxPages, {
        method: selectedFetchMethod,
        timeoutMs: COLLECT_FETCH_TIMEOUT_MS
      });
      const insertResult = await dbInsertItems(result.rows);

      inserted += insertResult.inserted;
      skipped += insertResult.skipped;
      checked += result.rows.length;
      errors.push(...result.errors);

      const firstPageDiag = result.diagnostics?.pages?.[0] || {};
      boardResults.push({
        board_id: src.board_id,
        category: boardLabel(src.board_id),
        checked: result.rows.length,
        inserted: insertResult.inserted,
        skipped: insertResult.skipped,
        latestDate: result.diagnostics?.latestDate || '',
        latestPageDate: result.diagnostics?.latestPageDate || '',
        fetchMethod: firstPageDiag.fetchMethod || selectedFetchMethod,
        fetchErrorDetail: firstPageDiag.fetchErrorDetail || '',
        htmlLength: firstPageDiag.htmlLength || 0,
        lineCount: firstPageDiag.lineCount || 0,
        totalMarker: firstPageDiag.totalMarker ? 'Y' : 'N',
        anchorRows: firstPageDiag.anchorRows || 0,
        datebackRows: firstPageDiag.datebackRows || 0,
        dedupedRows: firstPageDiag.dedupedRows || 0,
        error: result.errors?.[0] || firstPageDiag.fetchErrorDetail || firstPageDiag.error || ''
      });
    } catch (err) {
      const errText = err?.message || String(err);
      errors.push(`${src.board_id}: ${errText}`);
      boardResults.push({
        board_id: src.board_id,
        category: boardLabel(src.board_id),
        checked: 0,
        inserted: 0,
        skipped: 0,
        latestDate: '',
        latestPageDate: '',
        fetchMethod: selectedFetchMethod,
        fetchErrorDetail: errText.slice(0, 1200),
        htmlLength: 0,
        lineCount: 0,
        totalMarker: 'N',
        anchorRows: 0,
        datebackRows: 0,
        dedupedRows: 0,
        error: errText.slice(0, 1200)
      });
    }

    await delay(80);
  }

  await setMeta('last_collect_range', `${startDate}~${endDate}`);
  await setMeta('last_collect_mode', collectMode);
  await setMeta('last_collect_checked', String(checked));
  await setMeta('last_collect_fetch_method', selectedFetchMethod);
  return {
    inserted,
    skipped,
    checked,
    boardResults,
    errors: errors.slice(0, 20),
    stoppedByGlobalTimeout,
    elapsedMs: Date.now() - startedAt,
    apiVersion: API_VERSION,
    selectedFetchMethod,
    preflight
  };
}


async function collectSingleMfdsBoardToDb(src, startDate, endDate, collectMode = 'fast', fetchMethod = 'node-fetch') {
  const startedAt = Date.now();
  const days = Math.max(1, Math.floor((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  const maxPages = collectMode === 'fast' ? 1 : days <= 31 ? 5 : days <= 180 ? 10 : 15;

  const result = await parseMfdsBoard(src, startDate, endDate, maxPages, {
    method: fetchMethod,
    timeoutMs: COLLECT_FETCH_TIMEOUT_MS
  });
  const insertResult = await dbInsertItems(result.rows);
  const firstPageDiag = result.diagnostics?.pages?.[0] || {};
  const boardResult = {
    board_id: src.board_id,
    category: boardLabel(src.board_id),
    checked: result.rows.length,
    inserted: insertResult.inserted,
    skipped: insertResult.skipped,
    latestDate: result.diagnostics?.latestDate || '',
    latestPageDate: result.diagnostics?.latestPageDate || '',
    fetchMethod: firstPageDiag.fetchMethod || fetchMethod || '',
    fetchErrorDetail: firstPageDiag.fetchErrorDetail || '',
    htmlLength: firstPageDiag.htmlLength || 0,
    lineCount: firstPageDiag.lineCount || 0,
    totalMarker: firstPageDiag.totalMarker ? 'Y' : 'N',
    anchorRows: firstPageDiag.anchorRows || 0,
    datebackRows: firstPageDiag.datebackRows || 0,
    dedupedRows: firstPageDiag.dedupedRows || 0,
    error: result.errors?.[0] || firstPageDiag.fetchErrorDetail || firstPageDiag.error || '',
    elapsedMs: Date.now() - startedAt
  };

  await setMeta('last_collect_range', `${startDate}~${endDate}`);
  await setMeta('last_collect_mode', collectMode);
  await setMeta('last_collect_checked', String(result.rows.length));
  await setMeta('last_collect_fetch_method', fetchMethod || '');

  return {
    inserted: insertResult.inserted,
    skipped: insertResult.skipped,
    checked: result.rows.length,
    boardResult,
    errors: result.errors || [],
    elapsedMs: Date.now() - startedAt,
    apiVersion: API_VERSION,
    selectedFetchMethod: fetchMethod
  };
}

function selectPreflightMethod(results = []) {
  const strong = results.find(r => r.ok && r.htmlLength > 0 && r.totalMarker);
  if (strong) return strong.method;
  const usable = results.find(r => r.ok && Number(r.htmlLength || 0) > 3000);
  if (usable) return usable.method;
  return null;
}

function makePreflightBoardResult(preflight, selectedMethod) {
  const selected = preflight?.results?.find(r => r.method === selectedMethod);
  return {
    board_id: 'preflight',
    category: '연결사전진단',
    checked: 0,
    inserted: 0,
    skipped: 0,
    latestDate: '',
    latestPageDate: '',
    fetchMethod: selectedMethod || 'none',
    fetchErrorDetail: selectedMethod
      ? `selected ${selectedMethod}; ${(preflight.results || []).map(r => `${r.method}:${r.ok ? 'OK' : 'FAIL'}:${r.elapsedMs}ms:${r.htmlLength}`).join(' / ')}`
      : `no fetch method succeeded; ${(preflight?.results || []).map(r => `${r.method}:${r.error || 'failed'}`).join(' / ')}`,
    htmlLength: selected?.htmlLength || 0,
    lineCount: selected?.lineCount || 0,
    totalMarker: selected?.totalMarker ? 'Y' : 'N',
    anchorRows: 0,
    datebackRows: 0,
    dedupedRows: 0,
    error: selectedMethod ? '' : '식약처 HTML을 받을 수 있는 fetch 방식이 없습니다.'
  };
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
    sources: MFDS_SOURCES.length,
    collectFetchTimeoutMs: COLLECT_FETCH_TIMEOUT_MS,
    collectGlobalTimeoutMs: COLLECT_GLOBAL_TIMEOUT_MS,
    diagnosticFetchTimeoutMs: DIAGNOSTIC_FETCH_TIMEOUT_MS,
    preflightFetchTimeoutMs: PREFLIGHT_FETCH_TIMEOUT_MS,
    collectMethod: COLLECT_METHOD
  });
});


app.post('/api/fetch-diagnostics', async (req, res, next) => {
  try {
    const boardId = String(req.body?.board_id || req.query?.board_id || 'm_99');
    const src = MFDS_SOURCES.find(x => x.board_id === boardId) || MFDS_SOURCES.find(x => x.board_id === 'm_99') || MFDS_SOURCES[0];
    const pageUrl = mfdsPagedUrl(src.url, 1);
    const results = await runFetchDiagnostics(pageUrl, DIAGNOSTIC_FETCH_TIMEOUT_MS);
    res.json({
      ok: true,
      apiVersion: API_VERSION,
      board_id: src.board_id,
      category: boardLabel(src.board_id),
      url: pageUrl,
      timeoutMs: DIAGNOSTIC_FETCH_TIMEOUT_MS,
      results
    });
  } catch (err) {
    next(err);
  }
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
    res.json({ apiVersion: API_VERSION, range, stats: summarize(all), filteredStats: summarize(filtered), recent, lastCollected: await dbLastCollected(), totalStored: all.length });
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
    res.json({ apiVersion: API_VERSION, range, total, totalPages, page: currentPage, pageSize, items, lastCollected: await dbLastCollected() });
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

app.post('/api/collect-preflight', async (_req, res, next) => {
  try {
    const src = MFDS_SOURCES.find(x => x.board_id === 'm_99') || MFDS_SOURCES[0];
    const pageUrl = mfdsPagedUrl(src.url, 1);
    const results = await runFetchDiagnostics(pageUrl, PREFLIGHT_FETCH_TIMEOUT_MS);
    const selectedFetchMethod = selectPreflightMethod(results);
    const preflight = {
      configured: false,
      url: pageUrl,
      results,
      method: selectedFetchMethod
    };
    res.json({
      ok: true,
      apiVersion: API_VERSION,
      selectedFetchMethod,
      preflight,
      boardResult: makePreflightBoardResult(preflight, selectedFetchMethod)
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/collect-board', async (req, res, next) => {
  try {
    const body = req.body || {};
    const boardId = String(body.board_id || body.boardId || '').trim();
    const src = MFDS_SOURCES.find(x => x.board_id === boardId);
    if (!src) {
      res.status(400).json({ ok: false, apiVersion: API_VERSION, error: `Unknown board_id: ${boardId}` });
      return;
    }

    const mode = body.mode === 'fast' ? 'fast' : 'period';
    const today = getTodayKst();
    const startDate = body.startDate || addDays(today, -7);
    const endDate = body.endDate || today;
    let fetchMethod = String(body.fetchMethod || body.method || '').trim();

    if (!fetchMethod || fetchMethod === 'auto') {
      const preflight = await chooseCollectFetchMethod();
      fetchMethod = preflight.method || 'node-fetch';
    }

    const result = await collectSingleMfdsBoardToDb(src, startDate, endDate, mode, fetchMethod);
    res.json({
      ok: true,
      mode,
      startDate,
      endDate,
      board_id: src.board_id,
      category: boardLabel(src.board_id),
      ...result,
      lastCollected: await dbLastCollected()
    });
  } catch (err) {
    next(err);
  }
});


app.get('/api/boards', (_req, res) => {
  res.json({ boards: MFDS_SOURCES.map(x => ({ board_id: x.board_id, category: boardLabel(x.board_id), url: x.url })) });
});


app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, apiVersion: API_VERSION, error: `API route not found: ${req.method} ${req.originalUrl}` });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '5m' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error('[api error]', req?.method, req?.originalUrl, err);
  if (res.headersSent) return;
  res.status(500).type('application/json').json({
    ok: false,
    apiVersion: API_VERSION,
    error: String(err?.message || err).slice(0, 1500),
    route: `${req?.method || ''} ${req?.originalUrl || ''}`.trim()
  });
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
