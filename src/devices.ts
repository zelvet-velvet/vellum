// The phones a page can be drawn in: the screen in CSS px (points), its corner radius, the cut-out, and the safe areas
// (status bar / island at the top, home indicator at the bottom). Sideways swaps them: the cut-out side and the home strip.
export interface Device {
    id: string; brand: string; name: string;
    w: number; h: number; radius: number;
    cut: "island" | "notch" | "hole" | "none";
    top: number; bottom: number;           // safe area upright
    side: { left: number; bottom: number }; // safe area sideways (cut-out on the left)
}

export const DEVICES: Device[] = [
    { id: "iphone-16-pro", brand: "Apple", name: "iPhone 16 Pro", w: 402, h: 874, radius: 62, cut: "island", top: 62, bottom: 34, side: { left: 62, bottom: 21 } },
    { id: "iphone-16-pro-max", brand: "Apple", name: "iPhone 16 Pro Max", w: 440, h: 956, radius: 62, cut: "island", top: 62, bottom: 34, side: { left: 62, bottom: 21 } },
    { id: "iphone-16", brand: "Apple", name: "iPhone 16", w: 393, h: 852, radius: 55, cut: "island", top: 59, bottom: 34, side: { left: 59, bottom: 21 } },
    { id: "iphone-14", brand: "Apple", name: "iPhone 13 / 14", w: 390, h: 844, radius: 47, cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12-pro-max", brand: "Apple", name: "iPhone 12 Pro Max", w: 428, h: 926, radius: 53, cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12", brand: "Apple", name: "iPhone 12 / 12 Pro", w: 390, h: 844, radius: 47, cut: "notch", top: 47, bottom: 34, side: { left: 47, bottom: 21 } },
    { id: "iphone-12-mini", brand: "Apple", name: "iPhone 12 mini", w: 375, h: 812, radius: 44, cut: "notch", top: 50, bottom: 34, side: { left: 50, bottom: 21 } },
    { id: "iphone-se", brand: "Apple", name: "iPhone SE", w: 375, h: 667, radius: 0, cut: "none", top: 20, bottom: 0, side: { left: 0, bottom: 0 } },
    { id: "pixel-8", brand: "Google", name: "Pixel 8", w: 412, h: 915, radius: 40, cut: "hole", top: 32, bottom: 24, side: { left: 32, bottom: 24 } },
    { id: "galaxy-s24", brand: "Samsung", name: "Galaxy S24", w: 360, h: 780, radius: 36, cut: "hole", top: 32, bottom: 24, side: { left: 32, bottom: 24 } },
];
export const deviceOf = (id?: string): Device => DEVICES.find((d) => d.id === id) ?? DEVICES[0];
// the screen as drawn (sideways swaps width and height) and its safe room
export const screenOf = (d: Device, side?: boolean) => side
    ? { W: d.h, H: d.w, safe: { top: 0, left: d.side.left, right: d.side.left, bottom: d.side.bottom } }
    : { W: d.w, H: d.h, safe: { top: d.top, left: 0, right: 0, bottom: d.bottom } };
