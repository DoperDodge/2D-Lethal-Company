export type MoonDef = {
  id: string;
  name: string;
  difficulty: "safe" | "easy" | "medium" | "hard";
  scrapMin: number;
  scrapMax: number;
  monsterBudget: number;
  description: string;
};

export const MOONS: Record<string, MoonDef> = {
  experimentation: {
    id: "experimentation",
    name: "Experimentation",
    difficulty: "easy",
    scrapMin: 8,
    scrapMax: 12,
    monsterBudget: 1,
    description: "Industrial-class facility. Your standard contractor stop. Multi-floor interior, exposed ductwork, flickering fluorescents.",
  },
};

export const DEFAULT_MOON_ID = "experimentation";
