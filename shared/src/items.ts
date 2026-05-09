import type { ItemId } from "./types.js";

export type ItemKind = "tool" | "scrap";

export type ItemDef = {
  id: ItemId;
  name: string;
  kind: ItemKind;
  description: string;
  price?: number; // for tools sold in store
  baseValue?: number; // for scrap, average sell price
  weight: number;
  twoHanded?: boolean;
  usable?: boolean;
};

export const ITEMS: Record<ItemId, ItemDef> = {
  flashlight: {
    id: "flashlight",
    name: "Flashlight",
    kind: "tool",
    description: "Brightens your forward sight cone. Toggle with F.",
    price: 15,
    weight: 1,
    usable: true,
  },
  walkie: {
    id: "walkie",
    name: "Walkie-Talkie",
    kind: "tool",
    description: "Broadcast to crew across any distance with audio degradation.",
    price: 12,
    weight: 1,
    usable: true,
  },
  shovel: {
    id: "shovel",
    name: "Shovel",
    kind: "tool",
    description: "Bonks monsters. Press LMB to swing.",
    price: 30,
    weight: 2,
    usable: true,
    twoHanded: true,
  },
  stun: {
    id: "stun",
    name: "Stun Grenade",
    kind: "tool",
    description: "Throw to stun monsters and crewmates. Press LMB to throw.",
    price: 40,
    weight: 1,
    usable: true,
  },
  ladder: {
    id: "ladder",
    name: "Extension Ladder",
    kind: "tool",
    description: "Deploy to traverse vertical gaps.",
    price: 60,
    weight: 3,
    usable: true,
    twoHanded: true,
  },
  // Scrap
  scrap_battery: { id: "scrap_battery", name: "Old Battery", kind: "scrap", description: "Heavy and dented.", baseValue: 18, weight: 2 },
  scrap_clock: { id: "scrap_clock", name: "Cracked Clock", kind: "scrap", description: "Still ticking.", baseValue: 22, weight: 1 },
  scrap_coil: { id: "scrap_coil", name: "Copper Coil", kind: "scrap", description: "Worth a few credits.", baseValue: 14, weight: 1 },
  scrap_gear: { id: "scrap_gear", name: "Toothed Gear", kind: "scrap", description: "Industrial grade.", baseValue: 28, weight: 2 },
  scrap_pipe: { id: "scrap_pipe", name: "Steel Pipe", kind: "scrap", description: "Bent but valuable.", baseValue: 16, weight: 2 },
  scrap_radio: { id: "scrap_radio", name: "Broken Radio", kind: "scrap", description: "Static only.", baseValue: 32, weight: 1 },
  scrap_skull: { id: "scrap_skull", name: "Plastic Skull", kind: "scrap", description: "Halloween prop?", baseValue: 40, weight: 1 },
};

export const STORE_ITEMS: ItemId[] = ["flashlight", "walkie", "shovel", "stun", "ladder"];
export const SCRAP_ITEMS: ItemId[] = [
  "scrap_battery",
  "scrap_clock",
  "scrap_coil",
  "scrap_gear",
  "scrap_pipe",
  "scrap_radio",
  "scrap_skull",
];
