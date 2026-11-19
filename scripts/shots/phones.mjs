// each named screen in Show, phone only, at double resolution: node phones.mjs <title part> <light.js> <outdir> <name>...
import fs from "fs";
const [, , part, lightFile, outDir, ...names] = process.argv;
const list = await (await fetch("http://localhost:9222/json/list")).json();
const t = list.find((p) => p.type === "page" && p.title.includes(part));
const ws = new WebSocket(t.webSocketDebuggerUrl); let n = 0; const wait = new Map();
const send = (method, params = {}) => new Promise((ok) => { const id = ++n; wait.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((ok) => (ws.onopen = ok));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const W = await ev("innerWidth"), H = await ev("innerHeight");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await sleep(500);
if (!(await ev("!!activeDocument.getElementById('vl-shot-light')"))) await ev(fs.readFileSync(lightFile, "utf8"));
const btn = (label) => `[...activeDocument.querySelectorAll('.vl-zpill button')].find(b => b.textContent.trim() === '${label}')?.click()`;
for (const name of names) {
  await ev(btn("Edit")); await sleep(600);
  const ok = await ev(`(() => { const r = [...activeDocument.querySelectorAll('.vl-prow')].find(r => r.querySelector('.vl-pn')?.textContent.trim() === ${JSON.stringify(name)}); if (!r) return false; (r.querySelector('.vl-rowmain') ?? r).click(); return true; })()`);
  if (!ok) { console.log("no row", name); continue; }
  await sleep(700); await ev(btn("Show")); await sleep(700); await ev(btn("Fit")); await sleep(700);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: H - 5, buttons: 0 }); await sleep(300);
  const r = await ev("(() => { const b = activeDocument.querySelector('.vl-phone').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()");
  const pad = 8, clip = { x: r[0] - pad, y: r[1] - pad, width: r[2] + 2 * pad, height: r[3] + 2 * pad, scale: 1 };
  const s = await send("Page.captureScreenshot", { format: "png", clip });
  const f = `${outDir}/${name.toLowerCase().replace(/\s+/g, "-")}.png`; fs.writeFileSync(f, Buffer.from(s.result.data, "base64")); console.log("saved", f, clip.width.toFixed(0), clip.height.toFixed(0));
}
await ev(btn("Edit"));
await send("Emulation.clearDeviceMetricsOverride"); ws.close();
