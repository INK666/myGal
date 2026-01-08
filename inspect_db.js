const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
const db = new Database(dbPath);

console.log('--- Tables ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(JSON.stringify(tables, null, 2));

tables.forEach(table => {
  console.log(`\n--- Schema for ${table.name} ---`);
  const schema = db.prepare(`PRAGMA table_info(${table.name})`).all();
  console.log(JSON.stringify(schema, null, 2));
});

db.close();
