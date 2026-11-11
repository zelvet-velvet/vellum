// Drive a running Obsidian (started with --remote-debugging-port=9222).
//   node scripts/cdp.mjs <title part> eval <file.js>
//   node scripts/cdp.mjs <title part> shot <out.png>
//   node scripts/cdp.mjs <title part> steps <steps.json>
// steps, in order: {size:[w,h,scale]} {reset:1} {eval:"js"} {click:[x,y]} {move:[x,y]} {drag:[x0,y0,x1,y1,mods?],hold?:1}
//                  {release:[x,y]} {wait:ms} {shot:"file.png",clip?:[x,y,w,h]}
import fs from "fs";

const [, , part, cmd, arg] = process.argv;
if (!arg || !["eval", "shot", "steps"].includes(cmd)) { console.error("usage: node scripts/cdp.mjs <title part> eval|shot|steps <file>"); process.exit(1); }
const list = await (await fetch("http://localhost:9222/json/list")).json();
const pages = list.filter((x) => x.type === "page");
const t = pages.find((x) => x.title.includes(part));
if (!t) { console.error("no window with that title:", pages.map((x) => x.title)); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
let n = 0;
const wait = new Map();
const send = (method, params = {}) => new Promise((ok) => { const id = ++n; wait.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
await new Promise((ok) => (ws.onopen = ok));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const shot = async (file, clip) => {
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 } } : {}) });
    fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log("saved", file);
};
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });

if (cmd === "eval") {
    const r = await evaluate(fs.readFileSync(arg, "utf8"));
    console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1));
} else if (cmd === "shot") {
    await shot(arg);
} else {
    for (const s of JSON.parse(fs.readFileSync(arg, "utf8"))) {
        if (s.size) { await send("Emulation.setDeviceMetricsOverride", { width: s.size[0], height: s.size[1], deviceScaleFactor: s.size[2] ?? 1, mobile: false }); await sleep(600); }
        if (s.eval) { const r = await evaluate(s.eval); console.log("eval:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result).slice(0, 600)); }
        if (s.click) { const [x, y] = s.click; await mouse("mouseMoved", x, y, { buttons: 0 }); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await sleep(250); }
        if (s.move) { await mouse("mouseMoved", s.move[0], s.move[1], { buttons: 0 }); await sleep(300); }
        if (s.drag) {
            const [x0, y0, x1, y1, mods = 0] = s.drag;
            await mouse("mouseMoved", x0, y0, { buttons: 0 });
            await mouse("mousePressed", x0, y0, { modifiers: mods });
            for (let i = 1; i <= 12; i++) { await mouse("mouseMoved", x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12, { modifiers: mods }); await sleep(30); }
            if (!s.hold) await mouse("mouseReleased", x1, y1, { modifiers: mods });
            await sleep(200);
        }
        if (s.wait) await sleep(s.wait);
        if (s.shot) await shot(s.shot, s.clip);
        if (s.release) await mouse("mouseReleased", s.release[0], s.release[1]);
        if (s.reset) await send("Emulation.clearDeviceMetricsOverride");
    }
}
ws.close();
process.exit(0);
