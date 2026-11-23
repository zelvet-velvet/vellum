// The phones a page can be drawn in: the screen in CSS px (points), its corner radius, the cut-out, and the safe areas
// (status bar / island at the top, home indicator at the bottom). Sideways swaps them: the cut-out side and the home strip.
// what a screen is: a phone and a tablet have a corner, a status bar and safe areas; a window and a web page start square,
// with none of them
export type DeviceKind = "phone" | "tablet" | "window" | "web";
export const KINDS: [DeviceKind, string][] = [["phone", "Phone"], ["tablet", "Tablet"], ["window", "Window"], ["web", "Web page"]];
export interface Device {
    id: string; brand: string; name: string; kind: DeviceKind;
    w: number; h: number; radius: number;
    cut: "island" | "notch" | "hole" | "none";
    top: number; bottom: number;           // safe area upright
    side: { left: number; bottom: number }; // safe area sideways (cut-out on the left)
}

export const DEVICES: Device[] = [
    { id: "iphone-air", brand: "Apple", name: "iPhone Air", w: 420, h: 912, radius: 62, kind: "phone", cut: "island", top: 68, bottom: 34, side: { left: 68, bottom: 21 } },
    { id: "iphone-16-pro", brand: "Apple", name: "iPhone 16 Pro / 17 / 17 Pro", w: 402, h: 874, radius: 62, kind: "phone", cut: "island", top: 62, bottom: 34, side: { left: 62, bottom: 21 } },
    { id: "iphone-16-pro-max", brand: "Apple", name: "iPhone 16 Pro Max / 17 Pro Max", w: 440, h: 956, radius: 62, kind: "phone", cut: "island", top: 62, bottom: 34, side: { left: 62, bottom: 21 } },
    { id: "iphone-16", brand: "Apple", name: "iPhone 16", w: 393, h: 852, radius: 55, kind: "phone", cut: "island", top: 59, bottom: 34, side: { left: 59, bottom: 21 } },
    { id: "iphone-14", brand: "Apple", name: "iPhone 13 / 14", w: 390, h: 844, radius: 47, kind: "phone", cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12-pro-max", brand: "Apple", name: "iPhone 12 Pro Max", w: 428, h: 926, radius: 53, kind: "phone", cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12", brand: "Apple", name: "iPhone 12 / 12 Pro", w: 390, h: 844, radius: 47, kind: "phone", cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12-mini", brand: "Apple", name: "iPhone 12 mini", w: 375, h: 812, radius: 44, kind: "phone", cut: "notch", top: 50, bottom: 34, side: { left: 50, bottom: 21 } },
    { id: "iphone-se", brand: "Apple", name: "iPhone SE", w: 375, h: 667, radius: 0, kind: "phone", cut: "none", top: 20, bottom: 0, side: { left: 0, bottom: 0 } },
    { id: "pixel-8", brand: "Google", name: "Pixel 8", w: 412, h: 915, radius: 40, kind: "phone", cut: "hole", top: 32, bottom: 24, side: { left: 32, bottom: 24 } },
    { id: "galaxy-s24", brand: "Samsung", name: "Galaxy S24 / S25", w: 360, h: 780, radius: 36, kind: "phone", cut: "hole", top: 32, bottom: 24, side: { left: 32, bottom: 24 } },
];
DEVICES.push({ id: "galaxy-s25-ultra", brand: "Samsung", name: "Galaxy S25 Ultra", w: 412, h: 891, radius: 24, kind: "phone", cut: "hole", top: 32, bottom: 24, side: { left: 32, bottom: 24 } });
// any other screen: "custom-<w>x<h>" (a phone: no cut-out, a status bar and a home strip like a modern phone), or
// "custom-<w>x<h>-<kind>" for a tablet, a window or a web page
export const customDevice = (w: number, h: number, kind: DeviceKind = "phone"): Device => {
    const id = `custom-${w}x${h}${kind === "phone" ? "" : `-${kind}`}`, name = `Custom ${w} × ${h}`;
    if (kind === "phone") return { id, brand: "Custom", name, kind, w, h, radius: 40, cut: "none", top: 44, bottom: 24, side: { left: 0, bottom: 20 } };
    if (kind === "tablet") return { id, brand: "Custom", name, kind, w, h, radius: 18, cut: "none", top: 24, bottom: 20, side: { left: 0, bottom: 20 } };
    return { id, brand: "Custom", name, kind, w, h, radius: 0, cut: "none", top: 0, bottom: 0, side: { left: 0, bottom: 0 } };
};
export const deviceOf = (id?: string): Device => {
    const m = /^custom-(\d{3,4})x(\d{3,4})(?:-(tablet|window|web))?$/.exec(id ?? "");
    if (m) return customDevice(Number(m[1]), Number(m[2]), (m[3] as DeviceKind | undefined) ?? "phone");
    return DEVICES.find((d) => d.id === id) ?? DEVICES[0];
};
// the status bar when the doc sets none: iOS on a phone or a tablet, none on a window or a web page
export const barOf = (d: Device): "ios" | "none" => d.kind === "phone" || d.kind === "tablet" ? "ios" : "none";
// a device with the doc's own corner (radius set in the doc), else as it is
export const framed = (d: Device, radius?: number): Device => radius === undefined ? d : { ...d, radius };
// the screen as drawn (sideways swaps width and height) and its safe room
export const screenOf = (d: Device, side?: boolean) => side
    ? { W: d.h, H: d.w, safe: { top: 0, left: d.side.left, right: d.side.left, bottom: d.side.bottom } }
    : { W: d.w, H: d.h, safe: { top: d.top, left: 0, right: 0, bottom: d.bottom } };
