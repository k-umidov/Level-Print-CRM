// Импорт материалов из JSON без дублей: node scripts/import-materials.js import/файл.json
// Если материал с таким названием уже есть — остаётся более высокая цена, пустая категория заполняется.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file) { console.error('Укажите файл: node scripts/import-materials.js import/файл.json'); process.exit(1); }
const dbPath = path.join(process.env.LP_DATA_DIR || path.join(__dirname, '..', 'data'), 'levelprint.db');
if (!fs.existsSync(dbPath)) { console.error('База не найдена. Сначала один раз запустите сайт (npm.cmd start).'); process.exit(1); }

const norm = (s) => String(s).toLowerCase().replace(/[ʻʼ'`’]/g, "'").replace(/fomeks/g, 'fomiks').replace(/samarez/g, 'samorez')
  .replace(/plasmast|plasmassa|plastmasa/g, 'plastmassa').replace(/\s*([*,()])\s*/g, '$1').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

const db = new DatabaseSync(dbPath);
if (!db.prepare('PRAGMA table_info(materials)').all().some((c) => c.name === 'category')) {
  console.error('Сначала запустите новую версию сайта (npm.cmd start), чтобы обновить базу.'); process.exit(1);
}
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
const newKeys = new Set(items.map((it) => norm(it.name)));
const rows = db.prepare('SELECT id, name, price, category FROM materials').all();
const existing = new Map(rows.map((m) => [norm(m.name), m]));
const insert = db.prepare('INSERT INTO materials (name, kind, unit, price, category) VALUES (?, ?, ?, ?, ?)');
const update = db.prepare('UPDATE materials SET price = ?, unit = ?, kind = ? WHERE id = ?');
const setCat = db.prepare("UPDATE materials SET category = ? WHERE id = ? AND category = ''");
const rename = db.prepare('UPDATE materials SET name = ? WHERE id = ?');

let added = 0, raised = 0, kept = 0, renamed = 0;
db.exec('BEGIN');
try {
  for (const it of items) {
    const key = norm(it.name);
    const kind = it.kind === 'service' ? 'service' : 'material';
    let old = existing.get(key);
    if (!old) {
      // Старое название вида «Имя (размер)», которого нет в новом файле, — то же самое, переименовываем
      for (const [k, m] of existing) {
        if (k.startsWith(key + '(') && !newKeys.has(k)) { rename.run(it.name, m.id); existing.delete(k); existing.set(key, m); old = m; renamed++; break; }
      }
    }
    if (!old) {
      const { lastInsertRowid } = insert.run(it.name, kind, it.unit || 'шт', Number(it.price) || 0, it.category || '');
      existing.set(key, { id: Number(lastInsertRowid), name: it.name, price: Number(it.price) });
      added++;
      continue;
    }
    if (it.category) setCat.run(it.category, old.id);
    if (Number(it.price) > old.price) { update.run(Number(it.price), it.unit || 'шт', kind, old.id); old.price = Number(it.price); raised++; }
    else kept++;
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(`Добавлено: ${added}. Переименовано: ${renamed}. Цена повышена: ${raised}. Уже были: ${kept}.`);
console.log(`Всего материалов в базе: ${db.prepare('SELECT COUNT(*) AS c FROM materials').get().c}`);
