const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

app.whenReady().then(() => {
  const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
  const db = new Database(dbPath);
  
  try {
    const rootPaths = db.prepare("SELECT * FROM root_paths").all();
    console.log('Root Paths:', JSON.stringify(rootPaths, null, 2));
  } catch (err) {
    console.error(err);
  }
  
  db.close();
  app.quit();
});
