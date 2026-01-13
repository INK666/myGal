const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

app.whenReady().then(() => {
  const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
  const db = new Database(dbPath);
  
  try {
    const gameTags = db.prepare("SELECT * FROM game_tags LIMIT 5").all();
    console.log('Game Tags:', JSON.stringify(gameTags, null, 2));
    
    const tags = db.prepare("SELECT * FROM tags LIMIT 5").all();
    console.log('Tags:', JSON.stringify(tags, null, 2));
  } catch (err) {
    console.error(err);
  }
  
  db.close();
  app.quit();
});
