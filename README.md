# MyGal - 管理游戏库里压缩文件和游戏文件

## 📱 功能特性

本项目会将根目录下的次级文件作为游戏项目导入，可使用自定义正则清洗符，最后再将原名称和清洗后名称进行匹配刮削。

## 导入以及清洗逻辑

A根目录/

      ├── ［pc］游戏1/           
      ├── 游戏2ver1.02/      
      ├── 游戏3/              
      ├── 游戏4.zip     
      └── 游戏5.jpg  
      └── [VJ123456]游戏5.rar 
  
导入>> ［pc］游戏1、 游戏2ver1.02 、 游戏3 、游戏4.zip 、游戏5.jpg 、[VJ123456]游戏5.rar 

刮削>>  游戏1、游戏2、游戏3 、游戏4 、游戏5、VJ123456
<div align="center">
<img width="400" height="302" alt="desk" src="https://github.com/user-attachments/assets/8e90962f-bc6c-4e50-aa5e-97198da811b5" />
<img width="400" height="302" alt="2" src="https://github.com/user-attachments/assets/9a2c625d-a9bf-4cc4-90ce-064d17f92c40" />
</div>


## 主要功能
基于 Electron + React + Vite 的本地游戏资源管理工具：集中管理游戏目录、标签与封面，并支持按范围批量刮削。
- **根目录管理**
  - 添加/删除多个游戏根目录，将根目录下次级文件全部作为游戏项目导入。
  - 一键刷新（扫描根目录并自动刮削更新的游戏）

- **游戏库浏览**
  - 网格、列表展示游戏列表，默认按导入时间倒序排列
  - **搜索**：按游戏名称、路径、标签快速检索
  - **标签系统**：创建/编辑/删除标签，给游戏添加/移除标签
  - **置顶**：将常玩的游戏置顶显示

- **游戏历史记录**
  - 记录通过此项目打开的游戏和打开方式，可点击历史记录快速打开游戏。

- **封面管理**
  - 手动选择封面文件更新
  - 增加截屏并作为封面按钮
  - 刮削源：

    VNDB Kana v2
    
    muyueGalgame
    
    Bangumi
    
    Steam
    
    DLsite
    
    SteamGridDB（需要 Key）
    
    IGDB（需要 Client ID/Secret ）
    
    VNDB（需要 Token）
    
  - **批量刮削封面、厂商名**：对缺失封面的游戏进行自动抓取，刮削得到的厂商名作为标签添加在游戏上
  - **刮削范围配置**：可选择“根目录参与批量刮削”，新增根目录默认勾选
  - **自定义正则**：可使用自定义正则清洗游戏文件名
  <img width="400" height="340" alt="屏幕截图 2026-02-07 104511" src="https://github.com/user-attachments/assets/25d99b22-0860-4cd4-925d-6a1b6b1628fd" />

- **背景图片**
  - 支持自定义项目背景图（jpg/png）
  - 可清除背景恢复默认
 
 **游戏卡片**
 
<img width="400" height="500" alt="card" src="https://github.com/user-attachments/assets/241471d3-feca-4194-9822-d0da0ff0a457" />

- 封面截图，直接截图作为游戏封面
- 扫描文件夹内部exe文件，左键单击直接运行，右键点击弹出右键转区菜单
- 快速定位游戏文件
- 打开进入游戏所在文件夹
- 删除游戏条目（删除后不删除本地文件，只添加进ignore名单，可在配置窗口内恢复）
 
<div align="center">

**如果这个项目对你有帮助，请给个 ⭐️ Star 支持一下！**

Made with ❤️ by [INK666](https://github.com/INK666)

</div>


