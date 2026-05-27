-- Optional manual schema for MFDS Regulatory Dashboard.
-- The Streamlit app creates these tables automatically at startup.
-- Use this only if you want to pre-create tables in Supabase SQL Editor.

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
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_date ON items(item_date);
CREATE INDEX IF NOT EXISTS idx_items_category_date ON items(category, item_date);
