export type BlipKind = "h" | "c" | "m";

export type Blip = { x: number; z: number; k: BlipKind };

export type HudSnapshot = {
  ready: boolean;
  mode: "menu" | "play" | "pause" | "dead";
  health: number;
  mag: number;
  magSize: number;
  reserve: number;
  weapon: string;
  weaponIndex: number;
  score: number;
  best: number;
  wave: number;
  hostiles: number;
  civils: number;
  hit: number;
  damage: number;
  message: string;
  reloading: number;
  spread: number;
  px: number;
  pz: number;
  pyaw: number;
  blips: Blip[];
  muted: boolean;
  locked: boolean;
  coarse: boolean;
  riding: boolean;
  kmh: number;
  nearCar: boolean;
};

export const INITIAL_HUD: HudSnapshot = {
  ready: false,
  mode: "menu",
  health: 100,
  mag: 12,
  magSize: 12,
  reserve: 60,
  weapon: "Vesper",
  weaponIndex: 0,
  score: 0,
  best: 0,
  wave: 1,
  hostiles: 0,
  civils: 0,
  hit: 0,
  damage: 0,
  message: "",
  reloading: 0,
  spread: 0,
  px: 0,
  pz: 36,
  pyaw: 0,
  blips: [],
  muted: false,
  locked: false,
  coarse: false,
  riding: false,
  kmh: 0,
  nearCar: false,
};
