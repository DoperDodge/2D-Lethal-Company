export type MoonDef = {
  id: string;
  name: string;
  difficulty: "safe" | "easy" | "medium" | "hard";
  // Whether this moon has a procgen industrial interior (vs. just a sell hub).
  hasFacility: boolean;
  // Whether this moon has a Company sell building you can walk into.
  hasCompanyBuilding: boolean;
  scrapMin: number;
  scrapMax: number;
  monsterBudget: number;
  description: string;
  // Travel cost in credits to fly here from the ship console (free for default Atrium).
  travelCost: number;
};

export const MOONS: Record<string, MoonDef> = {
  atrium: {
    id: "atrium",
    name: "Atrium",
    difficulty: "safe",
    hasFacility: false,
    hasCompanyBuilding: true,
    scrapMin: 0,
    scrapMax: 0,
    monsterBudget: 0,
    description: "Company trading outpost. No scavenge — walk into the company building to sell stowed scrap and meet quota.",
    travelCost: 0,
  },
  experimentation: {
    id: "experimentation",
    name: "Experimentation",
    difficulty: "easy",
    hasFacility: true,
    hasCompanyBuilding: false,
    scrapMin: 8,
    scrapMax: 12,
    monsterBudget: 1,
    description: "Industrial-class facility. Multi-room interior, exposed ductwork, flickering fluorescents.",
    travelCost: 0,
  },
};

// Lobbies start parked on Atrium so the crew has access to the sell desk
// and can fly to a salvage moon when they're ready.
export const DEFAULT_MOON_ID = "atrium";
