const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const sourceIcon = path.join(rootDir, 'icon.png');
const resDir = path.join(rootDir, 'android-app', 'android', 'app', 'src', 'main', 'res');
const publicDir = path.join(rootDir, 'android-app', 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 复制到移动端 public 目录供 Web 页面使用
fs.copyFileSync(sourceIcon, path.join(publicDir, 'icon.png'));
console.log('Copied icon.png to android-app/public/icon.png');

const mipmaps = [
  { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
  { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
  { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
  { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
  { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 }
];

async function generateIcons() {
  for (const m of mipmaps) {
    const targetFolder = path.join(resDir, m.dir);
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    // 1. ic_launcher.png (方角)
    await sharp(sourceIcon)
      .resize(m.iconSize, m.iconSize, { fit: 'cover' })
      .png()
      .toFile(path.join(targetFolder, 'ic_launcher.png'));

    // 2. ic_launcher_round.png (圆角/圆形遮罩)
    const circleBuffer = Buffer.from(
      `<svg width="${m.iconSize}" height="${m.iconSize}"><circle cx="${m.iconSize / 2}" cy="${m.iconSize / 2}" r="${m.iconSize / 2}" fill="#ffffff"/></svg>`
    );
    await sharp(sourceIcon)
      .resize(m.iconSize, m.iconSize, { fit: 'cover' })
      .composite([{ input: circleBuffer, blend: 'dest-in' }])
      .png()
      .toFile(path.join(targetFolder, 'ic_launcher_round.png'));

    // 3. ic_launcher_foreground.png (自适应前景)
    const innerPadding = Math.round(m.fgSize * 0.18);
    const innerSize = m.fgSize - innerPadding * 2;
    const innerImg = await sharp(sourceIcon)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    await sharp({
      create: {
        width: m.fgSize,
        height: m.fgSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: innerImg, top: innerPadding, left: innerPadding }])
      .png()
      .toFile(path.join(targetFolder, 'ic_launcher_foreground.png'));

    console.log(`Generated icons for ${m.dir}`);
  }
  console.log('All Android icons generated successfully!');
}

generateIcons().catch(err => {
  console.error('Error generating android icons:', err);
  process.exit(1);
});
