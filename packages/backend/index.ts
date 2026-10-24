import { createServer } from './src/server';

const { url } = createServer();
console.log(`Vibertron backend running on ${url} (ws: /ws)`);
