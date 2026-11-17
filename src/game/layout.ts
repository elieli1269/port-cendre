export type BlockStyle = "warehouse" | "tower" | "shop" | "kiosk";

export type Block = {
  x: number;
  z: number;
  hw: number;
  hd: number;
  h: number;
  style: BlockStyle;
};

/** Half-extent of the sealed district, in meters. */
export const WORLD = 50;

export const BLOCKS: Block[] = [
  { x: -26, z: -34, hw: 12, hd: 8, h: 8, style: "warehouse" },
  { x: -10, z: -38, hw: 6, hd: 6, h: 6, style: "warehouse" },
  { x: 20, z: -34, hw: 12, hd: 9, h: 10, style: "warehouse" },
  { x: -36, z: -10, hw: 8, hd: 10, h: 18, style: "tower" },
  { x: -34, z: 16, hw: 8, hd: 8, h: 9, style: "shop" },
  { x: -28, z: 36, hw: 10, hd: 6, h: 7, style: "shop" },
  { x: 36, z: -6, hw: 8, hd: 12, h: 22, style: "tower" },
  { x: 34, z: 20, hw: 8, hd: 8, h: 12, style: "tower" },
  { x: 24, z: 38, hw: 10, hd: 5, h: 6, style: "shop" },
  { x: -12, z: 34, hw: 6, hd: 6, h: 8, style: "shop" },
  { x: 12, z: 30, hw: 5, hd: 6, h: 5, style: "kiosk" },
  { x: -16, z: -8, hw: 4, hd: 4, h: 4, style: "kiosk" },
  { x: 16, z: 16, hw: 4, hd: 4, h: 5, style: "kiosk" },
];
