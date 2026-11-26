// Импорт прайс-листа из JSON без дублей: node scripts/import-pricelist.js import/pricelist.json
// Одинаковыми считаются позиции с тем же разделом, названием, размером и единицей; остаётся более высокая цена.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file) { console.error('Укажите файл: node scripts/import-pricelist.js import/pricelist.json'); process.exit(1); }
const dbPath = path.join(process.env.LP_DATA_DIR || path.join(__dirname, '..', 'data'), 'levelprint.db');
if (!fs.existsSync(dbPath)) { console.error('База не найдена. Сначала один раз запустите сайт (npm.cmd start).'); process.exit(1); }
const db = new DatabaseSync(dbPath);
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'price_list'").get()) {
  console.error('Сначала запустите новую версию сайта (npm.cmd start), чтобы обновить базу.'); process.exit(1);
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const keyOf = (x) => [x.category, x.name, x.size, x.unit].map(norm).join('|');

const existing = new Map(db.prepare('SELECT * FROM price_list').all().map((x) => [keyOf(x), x]));
const insert = db.prepare('INSERT INTO price_list (category, name, size, unit, price, note) VALUES (?, ?, ?, ?, ?, ?)');
const update = db.prepare('UPDATE price_list SET price = ? WHERE id = ?');
let added = 0, raised = 0, kept = 0;
db.exec('BEGIN');
try {
  for (const x of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const old = existing.get(keyOf(x));
    if (!old) {
      const { lastInsertRowid } = insert.run(x.category || '', x.name, x.size || '', x.unit || 'шт', Number(x.price) || 0, x.note || '');
      existing.set(keyOf(x), { id: Number(lastInsertRowid), price: Number(x.price) || 0 });
      added++;
    } else if (Number(x.price) > old.price) { update.run(Number(x.price), old.id); old.price = Number(x.price); raised++; }
    else kept++;
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(`Прайс-лист — добавлено: ${added}. Цена повышена: ${raised}. Уже были: ${kept}.`);
console.log(`Всего позиций в прайс-листе: ${db.prepare('SELECT COUNT(*) AS c FROM price_list').get().c}`);
