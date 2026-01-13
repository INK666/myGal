const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

app.whenReady().then(() => {
  const dbPath = path.join(__dirname, 'electron-data', 'gamemanage.db');
  const db = new Database(dbPath);
  
  try {
    console.log('--- game_paths data ---');
    const gamePaths = db.prepare("SELECT * FROM game_paths LIMIT 5").all();
    console.log(JSON.stringify(gamePaths, null, 2));
    
    console.log('\n--- games data ---');
    const games = db.prepare("SELECT * FROM games LIMIT 5").all();
    console.log(JSON.stringify(games, null, 2));
  } catch (err) {
    console.error(err);
  }
  
  db.close();
  app.quit();
});
