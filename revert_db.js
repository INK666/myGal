const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const dbDir = path.join(__dirname, 'electron-data');
  const dbPath = path.join(dbDir, 'gamemanage.db');
  const backupPath = path.join(dbDir, 'gamemanage.db.bak_' + Date.now());
  
  console.log('Starting database reversion...');
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database file not found!');
    app.quit();
    return;
  }
  
  // 1. Create backup
  fs.copyFileSync(dbPath, backupPath);
  console.log('Backup created at:', backupPath);
  
  const db = new Database(dbPath);
  
  try {
    db.transaction(() => {
      // 2. Drop problematic tables
      console.log('Dropping problematic tables...');
      db.prepare("DROP TABLE IF EXISTS game_paths").run();
      db.prepare("DROP TABLE IF EXISTS game_tags").run();
      db.prepare("DROP TABLE IF EXISTS games").run();
      
      // 3. Re-create tables with original schema from main.js
      console.log('Re-creating games table...');
      db.prepare(`
        CREATE TABLE games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          cover_path TEXT,
          root_path_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (root_path_id) REFERENCES root_paths(id) ON DELETE CASCADE
        )
      `).run();
      
      console.log('Re-creating game_tags table...');
      db.prepare(`
        CREATE TABLE game_tags (
          game_id INTEGER,
          tag_id INTEGER,
          PRIMARY KEY (game_id, tag_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
      `).run();
    })();
    
    console.log('Database reversion successful!');
  } catch (err) {
    console.error('Error during reversion:', err);
    console.log('Attempting to restore from backup...');
    db.close();
    fs.copyFileSync(backupPath, dbPath);
  } finally {
    if (db.open) db.close();
    app.quit();
  }
});
