// Bannerfall game data. Every tunable number lives here so balance passes
// never have to touch engine code. Rates are per game-hour, times are in
// game-minutes unless a name says otherwise.

export const CONFIG = {
  TICK_MIN: 5,                 // simulation step (game minutes)
  SEASON_DAYS: 35,             // season length
  START_PEASANTS: 60,
  START_RES: { gold: 300, food: 300, stone: 150, mana: 0 },
  PEASANT_FOOD: 0.1,           // food/h eaten per peasant (and per drafted peasant)
  PEASANT_TAX: 0.06,           // gold/h paid by each working peasant
  POP_GROWTH: 0.04,            // logistic growth rate per hour
  LABOR_PER_LEVEL: 4,          // peasants needed per economic building level
  STORAGE_BASE: 1500,          // storage cap per resource at keep 1
  STORAGE_GROWTH: 1.5,         // storage multiplier per keep level
  TILE_UPKEEP_K: 0.6,          // gold/h = K * (tiles-1)^P   (anti-snowball)
  TILE_UPKEEP_P: 1.45,
  TILE_UNREST_H: 12,           // newly captured tiles produce nothing for this long
  SUPPLY_FREE_RANGE: 3,        // hexes from capital with no supply penalty
  SUPPLY_PENALTY: 0.05,        // attack lost per hex beyond free range
  SUPPLY_FLOOR: 0.55,
  DOCTRINE_EVERY_H: 6,         // standing orders evaluated this often
  SIEGE_ASSAULT_AFTER_H: 24,   // default auto-assault if walls never break
  SACK_LOOT: 0.25,             // fraction of resources stolen on a successful sack
  SACK_SHIELD_H: 48,           // capital immunity after being sacked
  WALL_REPAIR_PER_H: 0.05,     // fraction of max wall HP repaired per hour when not besieged
  KEEP_LEAD: 3,                // other buildings may sit this many levels above the keep
  BUILDING_MAX: 25,
  BUILD_COST_GROWTH: 1.55,
  BUILD_TIME_GROWTH: 1.45,
  PROD_GROWTH: 1.12,
  BARBARIAN_SCALE: 1.35,       // neutral garrison strength exponent on distance
};

// ---------------------------------------------------------------- Units
// tags drive the counter table. phases: which combat phases the unit fires in.
// volley: list of volley rounds (1..3) it fires; charge: multiplier in charge phase;
// melee: multiplier on atk in melee rounds.
export const UNITS = {
  peasant:   { name: 'Peasant levy', atk: 2,  hp: 10, armor: 0, speed: 1.0, tags: ['infantry'],
               cost: {}, time: 0, upkeep: { food: 0.1 }, building: null, unlock: 0,
               melee: 1, desc: 'Drafted instantly from your workforce. Weak, but there when you need bodies.' },
  militia:   { name: 'Militia', atk: 6, hp: 22, armor: 1, speed: 1.0, tags: ['infantry'],
               cost: { gold: 20, food: 15 }, time: 3, upkeep: { gold: 0.05, food: 0.15 },
               building: 'barracks', unlock: 1, melee: 1, desc: 'Cheap swordsmen. Average at everything.' },
  pike:      { name: 'Pikemen', atk: 5, hp: 26, armor: 2, speed: 0.8, tags: ['infantry'],
               cost: { gold: 30, food: 15, stone: 10 }, time: 5, upkeep: { gold: 0.06, food: 0.15 },
               building: 'barracks', unlock: 3, melee: 1, charge: 1, desc: 'Triple damage to cavalry, strikes first against charges.' },
  shield:    { name: 'Shield wall', atk: 3, hp: 38, armor: 5, speed: 0.8, tags: ['infantry'],
               cost: { gold: 35, food: 15, stone: 20 }, time: 6, upkeep: { gold: 0.06, food: 0.15 },
               building: 'barracks', unlock: 5, melee: 1, screen: 3, desc: 'Draws arrow fire away from the rest of the army.' },
  knight:    { name: 'Knights', atk: 16, hp: 70, armor: 6, speed: 1.6, tags: ['heavy', 'cavalry'],
               cost: { gold: 160, food: 40, stone: 30 }, time: 30, upkeep: { gold: 1.0, food: 0.4 },
               building: 'barracks', unlock: 10, needs: { stables: 5 }, melee: 1, charge: 1.5,
               desc: 'Elite heavy cavalry. Wins melee, bleeds gold.' },
  archer:    { name: 'Archers', atk: 5, hp: 14, armor: 0, speed: 1.0, tags: ['ranged'],
               cost: { gold: 25, food: 10 }, time: 4, upkeep: { gold: 0.05, food: 0.12 },
               building: 'range', unlock: 1, volley: [1, 2, 3], melee: 0.3, desc: 'Fires every volley round. Shreds unarmored troops.' },
  crossbow:  { name: 'Crossbowmen', atk: 8, hp: 16, armor: 1, speed: 0.9, tags: ['ranged'], pierce: true,
               cost: { gold: 45, food: 10, stone: 10 }, time: 6, upkeep: { gold: 0.08, food: 0.12 },
               building: 'range', unlock: 5, volley: [1, 3], melee: 0.3, desc: 'Slow reload, ignores armor.' },
  musket:    { name: 'Musketeers', atk: 30, hp: 16, armor: 1, speed: 0.9, tags: ['ranged'], accuracy: 0.55,
               cost: { gold: 90, food: 15, stone: 15 }, time: 10, upkeep: { gold: 0.4, food: 0.12 },
               building: 'range', unlock: 8, tech: 'gunpowder', volley: [1, 3], melee: 0.4, shock: true,
               desc: 'Devastating, inaccurate volleys (with a long reload) that break morale.' },
  horsemen:  { name: 'Horsemen', atk: 9, hp: 32, armor: 2, speed: 2.5, tags: ['cavalry'],
               cost: { gold: 70, food: 30 }, time: 10, upkeep: { gold: 0.3, food: 0.4 },
               building: 'stables', unlock: 1, melee: 1, charge: 2, wallPenalty: 0.5, evasive: 0.5,
               desc: 'Fastest marches. Hard to hit with volleys, double damage on the charge, weak against walls.' },
  catapult:  { name: 'Catapult', atk: 2, hp: 45, armor: 2, speed: 0.5, tags: ['siege'], siege: 25,
               cost: { gold: 120, stone: 60 }, time: 20, upkeep: { gold: 0.3 },
               building: 'workshop', unlock: 1, volley: [1, 2, 3], melee: 0, desc: 'Cheap early wall damage.' },
  ballista:  { name: 'Ballista', atk: 12, hp: 40, armor: 2, speed: 0.6, tags: ['siege'], siege: 6,
               cost: { gold: 110, stone: 40 }, time: 20, upkeep: { gold: 0.3 },
               building: 'workshop', unlock: 4, volley: [1, 2, 3], melee: 0,
               desc: 'Bolt thrower. Hunts knights and mages, defends walls.' },
  trebuchet: { name: 'Trebuchet', atk: 0, hp: 80, armor: 3, speed: 0.4, tags: ['siege'], siege: 90, setupH: 6,
               cost: { gold: 320, stone: 220 }, time: 60, upkeep: { gold: 0.6 },
               building: 'workshop', unlock: 8, melee: 0, desc: 'Massive wall damage, but takes 6h to assemble on site.' },
  cannoneer: { name: 'Cannoneers', atk: 12, hp: 40, armor: 2, speed: 0.8, tags: ['siege'], siege: 70,
               cost: { gold: 420, stone: 120, food: 20 }, time: 45, upkeep: { gold: 1.0 },
               building: 'workshop', unlock: 10, tech: 'gunpowder', volley: [1], melee: 0,
               desc: 'Late-game siege. Fast wall breaks, no setup.' },
  mage:      { name: 'Mage', atk: 12, hp: 22, armor: 0, speed: 1.0, tags: ['mage'],
               cost: { gold: 110, mana: 60 }, time: 20, upkeep: { mana: 0.5, food: 0.1 },
               building: 'magetower', unlock: 1, volley: [1, 2, 3], melee: 0.3,
               desc: 'Battle stance: area damage vs massed infantry. Ward stance: shields the army from volleys.' },
};

// attacker tag/type -> target tag -> multiplier
export const COUNTERS = {
  pike:     { cavalry: 3 },
  horsemen: { ranged: 2, siege: 2 },
  knight:   { ranged: 1.5, siege: 1.5, infantry: 1.2 },
  archer:   { infantry: 1.2 },
  ballista: { heavy: 3.5, mage: 3.5 },
  crossbow: { heavy: 1.3 },
};

// ---------------------------------------------------------------- Buildings
// prod: base resource/h at level 1 (scaled by L * PROD_GROWTH^(L-1) and labor)
export const BUILDINGS = {
  keep:      { name: 'Keep', cost: { gold: 200, stone: 120 }, time: 10, max: 20,
               desc: 'Caps every other building level, raises storage, unlocks research.' },
  housing:   { name: 'Housing', cost: { gold: 60, stone: 30 }, time: 3, desc: '+60 population cap per level (grows).' },
  farm:      { name: 'Farms', cost: { gold: 50 }, time: 2, prod: { food: 14 }, econ: true, desc: 'Food. Every soldier and peasant eats.' },
  market:    { name: 'Market', cost: { gold: 40, stone: 20 }, time: 2, prod: { gold: 12 }, econ: true, desc: 'Gold.' },
  quarry:    { name: 'Quarry', cost: { gold: 60 }, time: 2, prod: { stone: 8 }, econ: true, desc: 'Stone for walls, siege, and upgrades.' },
  barracks:  { name: 'Barracks', cost: { gold: 80, stone: 40 }, time: 4, desc: 'Infantry and knights. +8% training speed per level.' },
  range:     { name: 'Archery range', cost: { gold: 80, stone: 30 }, time: 4, desc: 'Ranged units.' },
  stables:   { name: 'Stables', cost: { gold: 120, food: 80 }, time: 5, desc: 'Cavalry.' },
  workshop:  { name: 'Siege workshop', cost: { gold: 150, stone: 100 }, time: 6, desc: 'Siege engines.' },
  magetower: { name: 'Mage tower', cost: { gold: 150, stone: 80 }, time: 6, prod: { mana: 4 }, econ: true,
               desc: 'Mana, mages, and spell power.' },
  walls:     { name: 'Walls', cost: { gold: 60, stone: 90 }, time: 5,
               desc: 'Wall HP and tower fire against besiegers.' },
  watchtower:{ name: 'Watchtower', cost: { gold: 60, stone: 40 }, time: 3,
               desc: '+1 vision every 3 levels. Level 3+ reveals the makeup of incoming armies.' },
};

export const WALL = { hpBase: 600, hpGrowth: 1.18, towerDmg: 8 };   // towers: towerDmg * L per hour
export const HOUSING = { base: 120, perLevel: 60, growth: 1.08 };

// ---------------------------------------------------------------- Research
// effects are additive modifiers read by engine.mods()
export const TECHS = {
  // Economy
  crop_rotation: { tree: 'Economy', name: 'Crop rotation', cost: { gold: 150 }, time: 30, keep: 2, effects: { foodMult: 0.15 } },
  coinage:       { tree: 'Economy', name: 'Coinage', cost: { gold: 200 }, time: 45, keep: 2, effects: { goldMult: 0.15 } },
  masonry:       { tree: 'Economy', name: 'Masonry', cost: { gold: 250, stone: 100 }, time: 60, keep: 3, effects: { stoneMult: 0.2 } },
  guilds:        { tree: 'Economy', name: 'Guilds', cost: { gold: 600, stone: 300 }, time: 240, keep: 5, req: ['coinage'], effects: { buildSlots: 1 } },
  tax_reform:    { tree: 'Economy', name: 'Tax reform', cost: { gold: 900 }, time: 360, keep: 7, req: ['coinage'], effects: { taxMult: 0.5 } },
  banking:       { tree: 'Economy', name: 'Banking', cost: { gold: 3000, stone: 800 }, time: 900, keep: 10, req: ['tax_reform'], effects: { goldMult: 0.25 } },
  irrigation:    { tree: 'Economy', name: 'Irrigation', cost: { gold: 2500, stone: 1000 }, time: 900, keep: 10, req: ['crop_rotation'], effects: { foodMult: 0.25 } },
  // Military
  drill:         { tree: 'Military', name: 'Drill', cost: { gold: 250, food: 150 }, time: 60, keep: 2, effects: { infantryAtk: 0.1 } },
  conscription:  { tree: 'Military', name: 'Conscription', cost: { gold: 300 }, time: 90, keep: 3, effects: { peasantAtk: 1.0 } },
  pike_square:   { tree: 'Military', name: 'Pike square', cost: { gold: 500, stone: 200 }, time: 180, keep: 4, req: ['drill'], effects: { pikeVsCav: 0.5 } },
  veterans:      { tree: 'Military', name: 'Veteran instructors', cost: { gold: 1200 }, time: 480, keep: 6, req: ['drill'], effects: { trainSpeed: 0.25 } },
  plate:         { tree: 'Military', name: 'Plate armor', cost: { gold: 2000, stone: 1200 }, time: 720, keep: 8, req: ['drill'], effects: { armor: 2 } },
  chivalry:      { tree: 'Military', name: 'Chivalry', cost: { gold: 4000, food: 1500 }, time: 1200, keep: 11, req: ['plate'], effects: { knightAtk: 0.2 } },
  // Fortification
  stone_walls:   { tree: 'Fortification', name: 'Stone walls', cost: { gold: 300, stone: 300 }, time: 90, keep: 2, effects: { wallHp: 0.25 } },
  murder_holes:  { tree: 'Fortification', name: 'Murder holes', cost: { gold: 700, stone: 500 }, time: 240, keep: 5, req: ['stone_walls'], effects: { towerDmg: 0.5 } },
  garrison:      { tree: 'Fortification', name: 'Garrison doctrine', cost: { gold: 900 }, time: 300, keep: 6, effects: { defAtk: 0.15 } },
  moat:          { tree: 'Fortification', name: 'Moat', cost: { gold: 1500, stone: 1500 }, time: 600, keep: 8, req: ['stone_walls'], effects: { siegeTaken: -0.25 } },
  concentric:    { tree: 'Fortification', name: 'Concentric castle', cost: { gold: 5000, stone: 4000 }, time: 1440, keep: 12, req: ['moat', 'murder_holes'], effects: { wallHp: 0.5 } },
  // Arcane
  ley_tapping:   { tree: 'Arcane', name: 'Ley tapping', cost: { gold: 300, mana: 50 }, time: 90, keep: 2, effects: { manaMult: 0.3 } },
  scrying:       { tree: 'Arcane', name: 'Scrying', cost: { gold: 400, mana: 150 }, time: 120, keep: 3, req: ['ley_tapping'], effects: { spell_scry: 1 } },
  hex_of_sloth:  { tree: 'Arcane', name: 'Hex of sloth', cost: { gold: 700, mana: 300 }, time: 240, keep: 5, req: ['ley_tapping'], effects: { spell_hex: 1 } },
  wardstones:    { tree: 'Arcane', name: 'Wardstones', cost: { gold: 900, mana: 400, stone: 400 }, time: 300, keep: 6, req: ['ley_tapping'], effects: { spell_ward: 1 } },
  battle_magic:  { tree: 'Arcane', name: 'Battle magic', cost: { gold: 1500, mana: 800 }, time: 600, keep: 8, req: ['scrying'], effects: { mageAtk: 0.3 } },
  alchemy:       { tree: 'Arcane', name: 'Alchemy', cost: { gold: 2000, mana: 600, stone: 600 }, time: 720, keep: 8, req: ['ley_tapping'], effects: { manaMult: 0.2 } },
  gunpowder:     { tree: 'Arcane', name: 'Gunpowder', cost: { gold: 4000, mana: 1000, stone: 1500 }, time: 1440, keep: 10, req: ['alchemy'], effects: {} },
  // Logistics
  roads:         { tree: 'Logistics', name: 'Roads', cost: { gold: 300, stone: 200 }, time: 90, keep: 2, effects: { marchSpeed: 0.2 } },
  scouts:        { tree: 'Logistics', name: 'Scouts', cost: { gold: 250 }, time: 60, keep: 2, effects: { vision: 1 } },
  quartermasters:{ tree: 'Logistics', name: 'Quartermasters', cost: { gold: 900, food: 600 }, time: 360, keep: 5, req: ['roads'], effects: { upkeepMult: -0.15 } },
  supply_trains: { tree: 'Logistics', name: 'Supply trains', cost: { gold: 1400, food: 1000 }, time: 600, keep: 7, req: ['quartermasters'], effects: { supply: 0.5 } },
  administration:{ tree: 'Logistics', name: 'Administration', cost: { gold: 3000, stone: 1000 }, time: 900, keep: 9, req: ['quartermasters'], effects: { tileUpkeep: -0.3 } },
  forced_march:  { tree: 'Logistics', name: 'Forced march', cost: { gold: 2500, food: 1500 }, time: 900, keep: 10, req: ['roads'], effects: { marchSpeed: 0.3 } },
};

export const SPELLS = {
  scry: { name: 'Scry', tech: 'scrying', mana: 120, cooldownH: 12, desc: 'Reveal a rival castle\'s army and walls for 12h.' },
  hex:  { name: 'Hex of sloth', tech: 'hex_of_sloth', mana: 250, cooldownH: 24, desc: 'An enemy march heading at you takes 40% longer to arrive.' },
  ward: { name: 'Wardstones', tech: 'wardstones', mana: 300, cooldownH: 24, desc: 'Instantly repair 30% of wall HP and halve siege damage for 12h.' },
};

// ---------------------------------------------------------------- Map
export const TERRAIN = {
  plains:   { name: 'Plains',   yield: { food: 5 },            def: 0,    move: 1,   weight: 40 },
  forest:   { name: 'Forest',   yield: { gold: 3, food: 1 },   def: 0.2,  move: 1.5, weight: 20 },
  hills:    { name: 'Hills',    yield: { stone: 4 },           def: 0.25, move: 1.5, weight: 18 },
  river:    { name: 'River',    yield: { food: 3, gold: 3 },   def: 0.1,  move: 1.2, weight: 10 },
  leyline:  { name: 'Ley line', yield: { mana: 3 },            def: 0,    move: 1,   weight: 5 },
  mountain: { name: 'Mountain', yield: {},                     def: 0,    move: Infinity, weight: 7 },
};

export const RESOURCES = ['gold', 'food', 'stone', 'mana'];
