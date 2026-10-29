CREATE TABLE IF NOT EXISTS family_photos (
  photo_id TEXT PRIMARY KEY,
  drive_file_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_drive_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  folder_id TEXT,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
