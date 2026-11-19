// hover a point with the window treated as focused, then screenshot a clip: node hover.mjs <title part> <x> <y> <out.png> <cx> <cy> <cw> <ch>
import fs from "fs";
const [, , part, x, y, out, cx, cy, cw, ch] = process.argv;
const list = await (await fetch("http://localhost:9222/json/list")).json();
const t = list.find((p) => p.type === "page" && p.title.includes(part));
const ws = new WebSocket(t.webSocketDebuggerUrl); let n = 0; const wait = new Map();
const send = (method, params = {}) => new Promise((ok) => { const id = ++n; wait.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((ok) => (ws.onopen = ok));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
for (const [px, py] of [[+x - 40, +y + 30], [+x - 10, +y + 5], [+x, +y]]) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py, buttons: 0 }); await sleep(120); }
await sleep(1500);
const r = await send("Runtime.evaluate", { expression: "(()=>{const t=activeDocument.querySelector('.tooltip');if(!t)return null;const b=t.getBoundingClientRect();return [b.left,b.top,b.width,b.height].map(Math.round)})()", returnByValue: true });
console.log("tooltip", JSON.stringify(r.result?.result?.value));
const s = await send("Page.captureScreenshot", { format: "png", clip: { x: +cx, y: +cy, width: +cw, height: +ch, scale: 1 } });
fs.writeFileSync(out, Buffer.from(s.result.data, "base64")); console.log("saved", out);
await send("Emulation.setFocusEmulationEnabled", { enabled: false }); ws.close();
