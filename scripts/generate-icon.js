const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const sourcePng = path.join(projectRoot, 'icon.png');
const outputIco = path.join(projectRoot, 'icon.ico');

const toIcoBufferFromPngs = (images) => {
  const count = images.length;
  const headerSize = 6 + (16 * count);
  const header = Buffer.alloc(headerSize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = headerSize;
  for (let i = 0; i < count; i += 1) {
    const { size, png } = images[i];
    const entryOffset = 6 + (16 * i);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 0);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  }

  return Buffer.concat([header, ...images.map((v) => v.png)]);
};

const main = async () => {
  if (!fs.existsSync(sourcePng)) {
    if (fs.existsSync(outputIco)) return;
    process.stderr.write(`未生成 icon.ico：缺少图标源文件 ${sourcePng}\n`);
    process.stderr.write('请把你发的图标保存为项目根目录的 icon.png，然后重新执行 npm run build\n');
    return;
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const input = sharp(sourcePng);
  const metas = await input.metadata();
  if (!metas || !metas.width || !metas.height) {
    throw new Error('无法读取 icon.png 的尺寸信息');
  }

  const images = [];
  for (const size of sizes) {
    const png = await sharp(sourcePng)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toBuffer();
    images.push({ size, png });
  }

  const ico = toIcoBufferFromPngs(images);
  fs.writeFileSync(outputIco, ico);
};

main().catch((err) => {
  process.stderr.write((err && err.stack) ? String(err.stack) : String(err));
  process.stderr.write('\n');
  process.exit(1);
});
