# 清理「_incoming 被当成游戏收录」的遗留数据
#   执行：python cleanup_db.py            → 备份到 deleted_db_rows.json 后删除
#   还原：python cleanup_db.py --restore  → 按备份文件把行写回去
# 删除内容：
#   - game id 26（name='_incoming'，自动扫描入库的假游戏）及其在所有 game_id 引用表里的行
#   - settings 里被设置页回写固化的 apiUploadTargetDir（应恢复成"跟随所选根目录"的默认语义）
import sqlite3
import os
import json
import sys

DB = os.path.join(os.environ.get('APPDATA', ''), 'gamemanage', 'gamemanage.db')
HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.join(HERE, 'deleted_db_rows.json')
GAME_ID = 26
SETTING_KEYS = ['apiUploadTargetDir']


def main():
    restore = '--restore' in sys.argv
    con = sqlite3.connect(DB)
    con.execute('PRAGMA foreign_keys = OFF')
    cur = con.cursor()

    ref_tables = []
    for name, sql in cur.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        cols = [r[1] for r in cur.execute('PRAGMA table_info("%s")' % name).fetchall()]
        if 'game_id' in cols:
            ref_tables.append((name, cols))

    if restore:
        with open(BACKUP, encoding='utf-8') as f:
            data = json.load(f)
        total = 0
        for table, payload in data.get('game_rows', {}).items():
            cols = payload['columns']
            for row in payload['rows']:
                cur.execute(
                    'INSERT OR REPLACE INTO "%s" (%s) VALUES (%s)'
                    % (table, ','.join('"%s"' % c for c in cols), ','.join('?' * len(cols))), tuple(row))
                total += 1
        for key, value in data.get('settings_rows', []):
            cur.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value))
            total += 1
        con.commit()
        con.close()
        print('已还原文 %d 行（来自 %s）' % (total, BACKUP))
        return

    dump = {'game_id': GAME_ID, 'game_rows': {}, 'settings_rows': []}
    for table, cols in ref_tables:
        rows = cur.execute('SELECT * FROM "%s" WHERE game_id = ?' % table, (GAME_ID,)).fetchall()
        if rows:
            dump['game_rows'][table] = {'columns': cols, 'rows': [list(r) for r in rows]}
    for key in SETTING_KEYS:
        dump['settings_rows'] += [list(r) for r in
                                  cur.execute('SELECT key, value FROM settings WHERE key = ?', (key,)).fetchall()]

    with open(BACKUP, 'w', encoding='utf-8') as f:
        json.dump(dump, f, ensure_ascii=False, indent=2)
    print('备份 ->', BACKUP)
    print('  game_row:', json.dumps(
        cur.execute('SELECT id, name, path FROM games WHERE id = ?', (GAME_ID,)).fetchone(), ensure_ascii=False))
    print('  引用行  :', {t: len(v['rows']) for t, v in dump['game_rows'].items()})
    print('  settings:', dump['settings_rows'])

    for table, _ in ref_tables:
        n = cur.execute('DELETE FROM "%s" WHERE game_id = ?' % table, (GAME_ID,)).rowcount
        if n:
            print('删除 %s: %d 行' % (table, n))
    n = cur.execute('DELETE FROM games WHERE id = ?', (GAME_ID,)).rowcount
    print('删除 games: %d 行' % n)
    for key in SETTING_KEYS:
        n = cur.execute('DELETE FROM settings WHERE key = ?', (key,)).rowcount
        if n:
            print('删除 settings.%s: %d 行' % (key, n))
    con.commit()

    left = cur.execute("SELECT id, name, path FROM games WHERE name = '_incoming' OR path LIKE '%_incoming%'").fetchall()
    print('清理后残留 _incoming 记录:', left)
    con.close()


main()
