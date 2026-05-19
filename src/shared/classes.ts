export const CLASS_DEFINITIONS = [
  { id: "butcher", name: "Butcher", icon: "/assets/class-icons/butcher.svg" },
  { id: "cleric", name: "Cleric", icon: "/assets/class-icons/cleric.svg" },
  { id: "collarless", name: "Collarless", icon: "/assets/class-icons/collarless.svg" },
  { id: "druid", name: "Druid", icon: "/assets/class-icons/druid.svg" },
  { id: "fighter", name: "Fighter", icon: "/assets/class-icons/fighter.svg" },
  { id: "hunter", name: "Hunter", icon: "/assets/class-icons/hunter.svg" },
  { id: "jester", name: "Jester", icon: "/assets/class-icons/jester.svg" },
  { id: "mage", name: "Mage", icon: "/assets/class-icons/mage.svg" },
  { id: "monk", name: "Monk", icon: "/assets/class-icons/monk.svg" },
  { id: "necromancer", name: "Necromancer", icon: "/assets/class-icons/necromancer.svg" },
  { id: "psychic", name: "Psychic", icon: "/assets/class-icons/psychic.svg" },
  { id: "tank", name: "Tank", icon: "/assets/class-icons/tank.svg" },
  { id: "thief", name: "Thief", icon: "/assets/class-icons/thief.svg" },
  { id: "tinkerer", name: "Tinkerer", icon: "/assets/class-icons/tinkerer.svg" }
] as const;

export type ClassId = (typeof CLASS_DEFINITIONS)[number]["id"];

export const CLASS_BY_ID = Object.fromEntries(
  CLASS_DEFINITIONS.map((classInfo) => [classInfo.id, classInfo])
) as Record<ClassId, (typeof CLASS_DEFINITIONS)[number]>;

export const CLASS_IDS = CLASS_DEFINITIONS.map((classInfo) => classInfo.id) as ClassId[];

