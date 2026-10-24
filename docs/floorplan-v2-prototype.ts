// Prototype (coordinator) that validated the v2 floorplan pipeline on fixtures/blue-grid.png.
// Reference only, not part of the build. Run from a dir with pngjs installed: bun <this> <repo> <img> <outPrefix>
// Usage: bun proto.ts <repo> <img> <outPrefix>
const [repo, img, outp] = process.argv.slice(2) as [string, string, string];
const { PNG } = await import(`${import.meta.dir}/lib/node_modules/pngjs/lib/png.js`);
const fs = await import('node:fs');
let cv: any = (await import(`${repo}/packages/frontend/node_modules/@techstark/opencv-js/dist/opencv.js`)).default;
if (cv instanceof Promise) cv = await cv;
if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = r));

const png = PNG.sync.read(fs.readFileSync(img));
const { width: W, height: H } = png;
const save = (m: any, name: string) => { const o = new PNG({ width: m.cols, height: m.rows }); for (let i = 0; i < m.cols*m.rows; i++){const v=m.data[i];o.data[i*4]=v;o.data[i*4+1]=v;o.data[i*4+2]=v;o.data[i*4+3]=255;} fs.writeFileSync(`${outp}-${name}.png`, PNG.sync.write(o)); };

// 1. Ink mask: estimate background colour (median), ink = pixels whose luminance contrast vs
// background is high AND are low-saturation (white lines on blue, or black lines on white).
const n = W*H; const d = png.data;
const lum = new Float32Array(n), sat = new Float32Array(n);
for (let i = 0; i < n; i++) { const r=d[i*4],g=d[i*4+1],b=d[i*4+2]; const mx=Math.max(r,g,b), mn=Math.min(r,g,b); lum[i]=0.299*r+0.587*g+0.114*b; sat[i]= mx? (mx-mn)/mx : 0; }
const sorted = Float32Array.from(lum).sort(); const bgLum = sorted[Math.floor(n/2)]!;
const sortedS = Float32Array.from(sat).sort(); const bgSat = sortedS[Math.floor(n/2)]!;
const lightInk = bgLum < 128; // dark background => ink is light
const ink = new cv.Mat(H, W, cv.CV_8UC1);
for (let i = 0; i < n; i++) {
	const contrast = lightInk ? lum[i]! - bgLum : bgLum - lum[i]!;
	// grid lines: some contrast but still saturated like the background
	ink.data[i] = contrast > 70 && sat[i]! < bgSat * 0.6 ? 255 : 0;
}
console.log({ bgLum, bgSat, lightInk });
save(ink, '1ink');

// 2. Wall lines: keep only long horizontal/vertical runs.
const L = Math.round(Math.max(W, H) * 0.045);
const horiz = new cv.Mat(), vert = new cv.Mat(), walls = new cv.Mat();
cv.morphologyEx(ink, horiz, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(L, 1)));
cv.morphologyEx(ink, vert, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, L)));
cv.bitwise_or(horiz, vert, walls);
// fuse double-line walls
const t = Math.max(3, Math.round(Math.max(W, H) * 0.006)) | 1;
cv.morphologyEx(walls, walls, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(t, t)));
save(walls, '2walls');

// 3. Building envelope: largest external contour of walls.
const cs = new cv.MatVector(), hi = new cv.Mat();
cv.findContours(walls, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
let best = -1, bestA = 0;
for (let i = 0; i < cs.size(); i++) { const r = cv.boundingRect(cs.get(i)); if (r.width*r.height > bestA) { bestA = r.width*r.height; best = i; } }
const env = cv.boundingRect(cs.get(best));
console.log('envelope', env);

// 4. Rooms: close door gaps by dilating walls, flood free space, components inside envelope.
const door = Math.round(Math.max(env.width, env.height) * 0.035) | 1;
const closed = new cv.Mat();
cv.dilate(walls, closed, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(door, door)));
// mask everything outside the envelope as wall
const free = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0));
for (let y = env.y; y < env.y+env.height; y++) for (let x = env.x; x < env.x+env.width; x++) { const i=y*W+x; free.data[i] = closed.data[i] ? 0 : 255; }
save(free, '3free');
const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
const nl = cv.connectedComponentsWithStats(free, labels, stats, cents, 4, cv.CV_32S);
const rooms: any[] = [];
const envArea = env.width*env.height;
for (let l = 1; l < nl; l++) {
	const x = stats.intAt(l, 0), y = stats.intAt(l, 1), w = stats.intAt(l, 2), h = stats.intAt(l, 3), a = stats.intAt(l, 4);
	if (a < envArea * 0.008) continue;
	// grow back by the dilation radius
	const g = Math.floor(door/2);
	rooms.push({ x: x-g, y: y-g, w: w+2*g, h: h+2*g, fill: a/(w*h) });
}
console.log('rooms', rooms.length, rooms.map(r => `${r.x},${r.y} ${r.w}x${r.h} fill=${r.fill.toFixed(2)}`));

// overlay
const o = new PNG({ width: W, height: H });
for (let i = 0; i < n; i++) { const v = walls.data[i] ? 200 : (ink.data[i] ? 60 : 0); o.data[i*4]=v;o.data[i*4+1]=v;o.data[i*4+2]=v;o.data[i*4+3]=255; }
const px = (x:number,y:number,c:number[]) => { if(x>=0&&y>=0&&x<W&&y<H){const p=(y*W+x)*4;o.data[p]=c[0]!;o.data[p+1]=c[1]!;o.data[p+2]=c[2]!;} };
const cols = [[255,60,60],[60,255,60],[80,160,255],[255,200,0],[255,0,255],[0,255,255],[255,128,0],[180,255,120]];
rooms.forEach((r, i) => { const c = cols[i % cols.length]!; for (let k=0;k<3;k++){ for (let x=r.x;x<=r.x+r.w;x++){px(x,r.y+k,c);px(x,r.y+r.h-k,c);} for (let y=r.y;y<=r.y+r.h;y++){px(r.x+k,y,c);px(r.x+r.w-k,y,c);} } });
for (let x=env.x;x<=env.x+env.width;x++){px(x,env.y-4,[255,255,255]);px(x,env.y+env.height+4,[255,255,255]);}
fs.writeFileSync(`${outp}-4rooms.png`, PNG.sync.write(o));
