const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

app.whenReady().then(() => {
  const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
  const db = new Database(dbPath);
  
  try {
    const rootPath = db.prepare("SELECT * FROM root_paths WHERE id = 24").get();
    console.log('Root Path 24:', JSON.stringify(rootPath, null, 2));
  } catch (err) {
    console.error(err);
  }
  
  db.close();
  app.quit();
});
