import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [new URL('../apps/web', import.meta.url).pathname] }));
const svg = await readFile(new URL('../apps/web/public/icons/icon.svg', import.meta.url));
const png = (size) => sharp(svg).resize(size,size).png().toBuffer();
for (const [file,size] of [
  ['apps/web/public/icons/icon-192.png',192],
  ['apps/web/public/icons/icon-512.png',512],
  ['apps/web/public/icons/icon-maskable-512.png',512],
  ['apps/web/public/icons/apple-touch-icon.png',180],
  ['apps/desktop/build/icon.png',1024],
  ['apps/desktop/resources/icon.png',512],
]) await writeFile(file,await png(size));
// ICO containers support PNG image payloads, preserving small-mark sharpness.
const icoPng = await png(256);
const header = Buffer.alloc(22);
header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
header.writeUInt32LE(icoPng.length,14); header.writeUInt32LE(22,18);
await writeFile('apps/desktop/build/icon.ico',Buffer.concat([header,icoPng]));
if (process.platform === 'darwin') {
  const temp = await mkdtemp(join(tmpdir(),'inkway-brand-'));
  try {
    const set = join(temp,'Inkway.iconset'); await mkdir(set);
    for(const size of [16,32,128,256,512]) {
      await writeFile(join(set,`icon_${size}x${size}.png`),await png(size));
      await writeFile(join(set,`icon_${size}x${size}@2x.png`),await png(size*2));
    }
    execFileSync('iconutil',['-c','icns',set,'-o','apps/desktop/build/icon.icns']);
  } finally { await rm(temp,{recursive:true,force:true}); }
}
console.log('Inkway browser and desktop icons regenerated.');
