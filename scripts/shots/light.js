// Light screens for README shots: Ledgerline's light palette on the phone screens only (the editor stays dark).
// Run in the Vellum window: node scripts/cdp.mjs "Vellum ·" eval scripts/shots/light.js. A reload removes it; no file changes.
(() => { const d = activeDocument; d.getElementById('vl-shot-light')?.remove();
  const s = d.head.createEl('style', { attr: { id: 'vl-shot-light' } });
  s.textContent = `.vl-phone, .vl-screen, .vl-pthumb, .vl-tphone, .vl-peek { --zs-paper:#ECE9E1; --zs-paper-2:#E3DFD5; --zs-ink:#1C1B19; --zs-mut:#6D6A63; --zs-dim:#D5D1C7; --zs-loud:#E8461F; --zs-on-loud:#F6F3EC;
    --ze-bg:#ECE9E1; --ze-surface:#ECE9E1; --ze-surface-2:#E3DFD5; --ze-text:#1C1B19; --ze-text-2:#6D6A63; --ze-text-3:#6D6A63; --ze-line:#D5D1C7; --ze-line-strong:#1C1B19; --ze-accent:#E8461F; --ze-text-on-accent:#F6F3EC;
    --vl-paper:#ECE9E1; --vl-text:#1C1B19; --vl-dim:#6D6A63; --vl-line:#D5D1C7; --vl-tile:#D9D5CB; --vl-loud:#E8461F; --vl-accent:#E8461F; }
  .vl-screen [style*='rgb(18, 18, 20)'], .vl-spill [style*='rgb(18, 18, 20)'] { background-color: #DAD6CC !important; }`;
  return 'on'; })()
