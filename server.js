// LevelPrint CRM — сервер без внешних зависимостей (Node.js 22.5+)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.LP_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- База данных ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'levelprint.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'material',
    unit TEXT NOT NULL DEFAULT 'шт',
    price REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'шт',
    qty REAL NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('margin', '3'), ('vat', '12');
`);
// Обновление старой базы: должность сотрудника
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'position')) {
  db.exec("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT 'worker'");
  db.exec("UPDATE users SET position = 'director' WHERE role = 'admin'");
}
// Категория материала и прайс-лист (готовые цены для клиента)
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('materials', 'category')) db.exec("ALTER TABLE materials ADD COLUMN category TEXT NOT NULL DEFAULT ''");
db.exec(`
  CREATE TABLE IF NOT EXISTS price_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'шт',
    price REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  );
`);
// Источник позиции в калькуляции: base — из базы материалов, manual — вручную, price — из прайс-листа.
// Позиции из прайс-листа уже содержат наценку, поэтому маржа ×3 к ним не применяется.
if (!hasColumn('project_items', 'source')) {
  db.exec("ALTER TABLE project_items ADD COLUMN source TEXT NOT NULL DEFAULT 'base'");
  db.exec("UPDATE project_items SET source = 'manual' WHERE material_id IS NULL");
}
if (!hasColumn('project_items', 'price_id')) db.exec('ALTER TABLE project_items ADD COLUMN price_id INTEGER REFERENCES price_list(id) ON DELETE SET NULL');

const POSITIONS = ['director', 'cfo', 'supply', 'printer', 'sales', 'worker'];
const positionOf = (v, fallback = 'worker') => (POSITIONS.includes(v) ? v : fallback);

// ---------- Пароли и сессии ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}
const SESSION_DAYS = 30;
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).lp_session;
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.login, u.role, u.position, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return { id: row.id, name: row.name, login: row.login, role: row.role, position: row.position, token };
}
function sessionCookie(token, maxAgeSec) {
  return `lp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

// ---------- Помощники ----------
class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1e6) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
}
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
function num(v, { min = 0 } = {}) {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, 'bad_number');
  return n;
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'unauthorized');
  return u;
}
function requireAdmin(req) {
  const u = requireUser(req);
  if (u.role !== 'admin') throw new HttpError(403, 'forbidden');
  return u;
}
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return { margin: s.margin ?? 3, vat: s.vat ?? 12 };
}
function projectTotals(projectId, settings = getSettings()) {
  const { cost, retail } = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN source != 'price' THEN qty * price END), 0) AS cost,
      COALESCE(SUM(CASE WHEN source = 'price' THEN qty * price END), 0) AS retail
    FROM project_items WHERE project_id = ?`).get(projectId);
  const withMargin = cost * settings.margin + retail;
  const vat = withMargin * settings.vat / 100;
  return { cost, retail, withMargin, vat, total: withMargin + vat };
}
function nextProjectNumber() {
  const rows = db.prepare('SELECT number FROM projects').all();
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number, 10) || 0), 0);
  return String(max + 1).padStart(4, '0');
}
function adminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get().c;
}

// Простая защита от подбора пароля: 10 неудачных попыток за 15 минут с одного адреса
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const rec = failedLogins.get(ip);
  return rec && rec.count >= 10 && Date.now() - rec.first < 15 * 60e3;
}
function noteFailure(ip) {
  const rec = failedLogins.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60e3) failedLogins.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

// ---------- Маршруты API ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// Первый запуск: создание администратора, если пользователей ещё нет
route('GET', '/api/setup', () => ({ needed: db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0 }));
route('POST', '/api/setup', async (req, _p, res) => {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) throw new HttpError(403, 'setup_done');
  const b = await readBody(req);
  const name = str(b.name), login = str(b.login, 50), password = String(b.password || '');
  if (!name || !login) throw new HttpError(400, 'required');
  if (password.length < 6) throw new HttpError(400, 'short_password');
  const { lastInsertRowid } = db.prepare("INSERT INTO users (name, login, pass_hash, role, position) VALUES (?, ?, ?, 'admin', 'director')")
    .run(name, login, hashPassword(password));
  const token = createSession(Number(lastInsertRowid));
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
});

route('POST', '/api/login', async (req, _p, res) => {
  const ip = req.socket.remoteAddress;
  if (tooManyAttempts(ip)) throw new HttpError(429, 'too_many');
  const b = await readBody(req);
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(str(b.login, 50));
  if (!user || !checkPassword(String(b.password || ''), user.pass_hash)) {
    noteFailure(ip);
    throw new HttpError(401, 'bad_credentials');
  }
  if (!user.active) throw new HttpError(403, 'blocked');
  failedLogins.delete(ip);
  const token = createSession(user.id);
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
});
route('POST', '/api/logout', (req, _p, res) => {
  const token = parseCookies(req).lp_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
});
route('GET', '/api/me', (req) => {
  const u = requireUser(req);
  return { user: { id: u.id, name: u.name, login: u.login, role: u.role, position: u.position }, settings: getSettings() };
});

// Материалы: смотреть могут все, менять — только администратор
const KINDS = ['material', 'service'];
function materialFrom(b) {
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'required');
  return { name, kind: KINDS.includes(b.kind) ? b.kind : 'material', unit: str(b.unit, 20) || 'шт', price: num(b.price), category: str(b.category, 80) };
}
route('GET', '/api/materials', (req) => {
  requireUser(req);
  return db.prepare('SELECT * FROM materials ORDER BY category COLLATE NOCASE, name COLLATE NOCASE').all();
});
route('POST', '/api/materials', async (req) => {
  requireAdmin(req);
  const m = materialFrom(await readBody(req));
  const { lastInsertRowid } = db.prepare('INSERT INTO materials (name, kind, unit, price, category) VALUES (?, ?, ?, ?, ?)').run(m.name, m.kind, m.unit, m.price, m.category);
  return { id: Number(lastInsertRowid) };
});
route('PUT', '/api/materials/:id', async (req, p) => {
  requireAdmin(req);
  const m = materialFrom(await readBody(req));
  db.prepare('UPDATE materials SET name = ?, kind = ?, unit = ?, price = ?, category = ? WHERE id = ?').run(m.name, m.kind, m.unit, m.price, m.category, p.id);
  return { ok: true };
});
route('DELETE', '/api/materials/:id', (req, p) => {
  requireAdmin(req);
  db.prepare('DELETE FROM materials WHERE id = ?').run(p.id);
  return { ok: true };
});

// Проекты: все сотрудники видят и редактируют все проекты
route('GET', '/api/projects/next-number', (req) => { requireUser(req); return { number: nextProjectNumber() }; });
route('GET', '/api/projects', (req) => {
  requireUser(req);
  const settings = getSettings();
  const rows = db.prepare(`
    SELECT p.id, p.number, p.name, u.name AS author,
      (SELECT COUNT(*) FROM project_items i WHERE i.project_id = p.id) AS items
    FROM projects p LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.id DESC`).all();
  return rows.map((r) => ({ ...r, total: projectTotals(r.id, settings).total }));
});
route('POST', '/api/projects', async (req) => {
  const u = requireUser(req);
  const b = await readBody(req);
  const name = str(b.name), number = str(b.number, 30) || nextProjectNumber();
  if (!name) throw new HttpError(400, 'required');
  if (db.prepare('SELECT 1 FROM projects WHERE number = ?').get(number)) throw new HttpError(409, 'number_taken');
  const { lastInsertRowid } = db.prepare('INSERT INTO projects (number, name, created_by) VALUES (?, ?, ?)').run(number, name, u.id);
  return { id: Number(lastInsertRowid) };
});
route('GET', '/api/projects/:id', (req, p) => {
  requireUser(req);
  const project = db.prepare(`SELECT p.*, u.name AS author FROM projects p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`).get(p.id);
  if (!project) throw new HttpError(404, 'not_found');
  project.items = db.prepare('SELECT * FROM project_items WHERE project_id = ? ORDER BY id').all(p.id);
  return project;
});
route('PUT', '/api/projects/:id', async (req, p) => {
  requireUser(req);
  const b = await readBody(req);
  const name = str(b.name), number = str(b.number, 30);
  if (!name || !number) throw new HttpError(400, 'required');
  if (db.prepare('SELECT 1 FROM projects WHERE number = ? AND id != ?').get(number, p.id)) throw new HttpError(409, 'number_taken');
  db.prepare('UPDATE projects SET name = ?, number = ? WHERE id = ?').run(name, number, p.id);
  return { ok: true };
});
route('DELETE', '/api/projects/:id', (req, p) => {
  requireAdmin(req);
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  return { ok: true };
});

// Позиции калькуляции
route('POST', '/api/projects/:id/items', async (req, p) => {
  requireUser(req);
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(p.id)) throw new HttpError(404, 'not_found');
  const b = await readBody(req);
  const qty = num(b.qty ?? 1);
  let item;
  if (b.material_id) {
    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(Number(b.material_id));
    if (!m) throw new HttpError(404, 'not_found');
    item = { source: 'base', material_id: m.id, price_id: null, name: m.name, unit: m.unit, price: m.price };
  } else if (b.price_id) {
    const pr = db.prepare('SELECT * FROM price_list WHERE id = ?').get(Number(b.price_id));
    if (!pr) throw new HttpError(404, 'not_found');
    const name = [pr.name, pr.size && `(${pr.size})`].filter(Boolean).join(' ');
    item = { source: 'price', material_id: null, price_id: pr.id, name, unit: pr.unit, price: pr.price };
  } else {
    const name = str(b.name);
    if (!name) throw new HttpError(400, 'required');
    item = { source: 'manual', material_id: null, price_id: null, name, unit: str(b.unit, 20) || 'шт', price: num(b.price) };
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO project_items (project_id, material_id, price_id, source, name, unit, qty, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(p.id, item.material_id, item.price_id, item.source, item.name, item.unit, qty, item.price);
  return { id: Number(lastInsertRowid) };
});
route('PUT', '/api/items/:id', async (req, p) => {
  requireUser(req);
  const b = await readBody(req);
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'required');
  db.prepare('UPDATE project_items SET name = ?, unit = ?, qty = ?, price = ? WHERE id = ?')
    .run(name, str(b.unit, 20) || 'шт', num(b.qty), num(b.price), p.id);
  return { ok: true };
});
route('DELETE', '/api/items/:id', (req, p) => {
  requireUser(req);
  db.prepare('DELETE FROM project_items WHERE id = ?').run(p.id);
  return { ok: true };
});

// Админ-панель: сотрудники и настройки
route('GET', '/api/users', (req) => {
  requireAdmin(req);
  return db.prepare('SELECT id, name, login, role, position, active FROM users ORDER BY id').all();
});
route('POST', '/api/users', async (req) => {
  requireAdmin(req);
  const b = await readBody(req);
  const name = str(b.name), login = str(b.login, 50), password = String(b.password || '');
  if (!name || !login) throw new HttpError(400, 'required');
  if (password.length < 6) throw new HttpError(400, 'short_password');
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw new HttpError(409, 'login_taken');
  const role = b.role === 'admin' ? 'admin' : 'employee';
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, login, pass_hash, role, position) VALUES (?, ?, ?, ?, ?)').run(name, login, hashPassword(password), role, positionOf(b.position));
  return { id: Number(lastInsertRowid) };
});
route('PUT', '/api/users/:id', async (req, p) => {
  const me = requireAdmin(req);
  const b = await readBody(req);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.id);
  if (!user) throw new HttpError(404, 'not_found');
  const name = str(b.name) || user.name;
  const role = b.role === 'admin' ? 'admin' : b.role === 'employee' ? 'employee' : user.role;
  const position = positionOf(b.position, user.position);
  const active = b.active === undefined ? user.active : (b.active ? 1 : 0);
  // Нельзя отнять права или заблокировать самого себя — иначе можно остаться без администратора
  if (user.id === me.id && (role !== 'admin' || !active)) throw new HttpError(400, 'self_lock');
  db.prepare('UPDATE users SET name = ?, role = ?, position = ?, active = ? WHERE id = ?').run(name, role, position, active, p.id);
  if (b.password) {
    if (String(b.password).length < 6) throw new HttpError(400, 'short_password');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(String(b.password)), p.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(p.id, me.token);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(p.id);
  return { ok: true };
});
route('DELETE', '/api/users/:id', (req, p) => {
  const me = requireAdmin(req);
  if (Number(p.id) === me.id) throw new HttpError(400, 'self_lock');
  db.prepare('DELETE FROM users WHERE id = ?').run(p.id);
  return { ok: true };
});
route('PUT', '/api/settings', async (req) => {
  requireAdmin(req);
  const b = await readBody(req);
  const margin = num(b.margin), vat = num(b.vat);
  if (margin <= 0 || vat > 100) throw new HttpError(400, 'bad_number');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'margin'").run(String(margin));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'vat'").run(String(vat));
  return getSettings();
});
function priceFrom(b) {
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'required');
  return { category: str(b.category, 80), name, size: str(b.size, 60), unit: str(b.unit, 20) || 'шт', price: num(b.price), note: str(b.note, 200) };
}
route('GET', '/api/pricelist', (req) => {
  requireUser(req);
  return db.prepare('SELECT * FROM price_list ORDER BY id').all();
});
route('POST', '/api/pricelist', async (req) => {
  requireAdmin(req);
  const x = priceFrom(await readBody(req));
  const { lastInsertRowid } = db.prepare('INSERT INTO price_list (category, name, size, unit, price, note) VALUES (?, ?, ?, ?, ?, ?)').run(x.category, x.name, x.size, x.unit, x.price, x.note);
  return { id: Number(lastInsertRowid) };
});
route('PUT', '/api/pricelist/:id', async (req, p) => {
  requireAdmin(req);
  const x = priceFrom(await readBody(req));
  db.prepare('UPDATE price_list SET category = ?, name = ?, size = ?, unit = ?, price = ?, note = ? WHERE id = ?').run(x.category, x.name, x.size, x.unit, x.price, x.note, p.id);
  return { ok: true };
});
route('DELETE', '/api/pricelist/:id', (req, p) => {
  requireAdmin(req);
  db.prepare('DELETE FROM price_list WHERE id = ?').run(p.id);
  return { ok: true };
});

route('GET', '/api/stats', (req) => {
  requireAdmin(req);
  const c = (sql) => db.prepare(sql).get().c;
  return {
    projects: c('SELECT COUNT(*) AS c FROM projects'),
    materials: c('SELECT COUNT(*) AS c FROM materials'),
    users: c('SELECT COUNT(*) AS c FROM users'),
    admins: adminCount(),
  };
});

// ---------- Статические файлы ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- Сервер ----------
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res);
  // Запросы, меняющие данные, принимаем только как JSON — это защищает от подделки форм с чужих сайтов
  if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) {
    return send(res, 415, { error: 'json_only' });
  }
  const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { error: 'not_found' });
  const m = pathname.match(r.re);
  const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
  try {
    const result = await r.handler(req, params, res);
    if (!res.headersSent && result !== undefined) send(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.code });
    console.error(err);
    send(res, 500, { error: 'server_error' });
  }
});

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
server.listen(PORT, () => console.log(`LevelPrint CRM: http://localhost:${PORT}`));
