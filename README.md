适合一堆游戏文件、未知后缀的压缩包全扔进某一文件夹的囤积虫。根目录下次级文件全部作为游戏项目导入，刮削文件名时会清洗掉 [] 内容、 .号后跟着的字符，最后再将原名称和清洗后名称进行匹配刮削。
基于 Electron + React + Vite 的本地游戏资源管理工具：集中管理游戏目录、标签与封面，并支持按范围批量刮削封面。
<img width="896" height="590" alt="首页" src="https://github.com/user-attachments/assets/89d53a80-b751-4737-a5fb-69cc5e184bf1" />


## 主要功能

- **根目录管理**
  - 添加/删除多个游戏根目录，将根目录下次级文件全部作为游戏项目导入。
  - 一键刷新导入（扫描根目录并更新库内数据）

- **游戏库浏览**
  - 网格化展示游戏列表
  - **搜索**：按游戏名称、路径、标签快速检索
  - **标签系统**：创建/编辑/删除标签，给游戏添加/移除标签
  - **置顶**：将常玩的游戏置顶显示

- **封面管理**
  - 手动选择封面文件更新
  - 增加截屏并作为封面按钮
  - 刮削源：

    VNDB Kana v2
    muyueGalgame
    Steam
    Bangumi
    SteamGridDB（需要 Key）未测试
    IGDB（需要 Client ID/Secret）未测试
    VNDB（需要 Token）未测试
    DLsite（RJ/VJ 号）未测试

  - **批量刮削封面**：对缺失封面的游戏进行自动抓取
  - **刮削范围配置**：可选择“哪些根目录参与批量刮削”，新增根目录默认勾选

- **背景图片**
  - 支持自定义项目背景图（jpg/png）
  - 可清除背景恢复默认
 
  - - **游戏卡片**
<img width="899" height="601" alt="gameCard" src="https://github.com/user-attachments/assets/810d3c2e-6f21-48d9-a677-18769ede148a" />

- 封面截图，直接截图作为游戏封面
- 扫描文件夹内部exe文件，可直接点击运行
- 打开游戏所在文件夹
- 删除游戏条目（不删除本地文件，具体以实现为准）
 

## 技术栈

- Electron
- React 18
- Vite 5
- Tailwind CSS
- SQLite（better-sqlite3）
