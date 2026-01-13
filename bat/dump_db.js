const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
  console.log('Database path:', dbPath);
  
  try {
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables.map(t => t.name).join(', '));
    
    tables.forEach(table => {
      console.log(`\nSchema for ${table.name}:`);
      const info = db.prepare(`PRAGMA table_info(${table.name})`).all();
      info.forEach(col => {
        console.log(`  - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PK' : ''}`);
      });
    });
    
    db.close();
  } catch (err) {
    console.error('Error reading database:', err);
  }
  
  app.quit();
});
