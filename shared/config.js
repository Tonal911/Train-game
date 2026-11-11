// Game-wide constants. Everything here is data: add a card color, change deck size,
// extend the scoring table, and the engine, generator and UI follow.

/** Train card colors. `model` picks the 3D toy wagon; `shape` is the colorblind corner symbol. */
export const CARD_COLORS = [
  { id: 'red', name: 'Red', hex: '#ff2323', dark: '#a30000', shape: 'star', model: 'boxcar' },
  { id: 'orange', name: 'Orange', hex: '#ff8c00', dark: '#a85400', shape: 'circle', model: 'tanker' },
  { id: 'yellow', name: 'Yellow', hex: '#ffe014', dark: '#a68c00', shape: 'triangle', model: 'caboose' },
  { id: 'green', name: 'Green', hex: '#1fc62e', dark: '#0b6e15', shape: 'square', model: 'logs' },
  { id: 'blue', name: 'Blue', hex: '#2366ff', dark: '#0b2f99', shape: 'diamond', model: 'passenger' },
  { id: 'purple', name: 'Purple', hex: '#b030ff', dark: '#5f0f99', shape: 'heart', model: 'circus' },
  { id: 'black', name: 'Black', hex: '#262626', dark: '#000000', shape: 'bolt', model: 'hopper' },
  { id: 'white', name: 'White', hex: '#f4f4f4', dark: '#8a8a8a', shape: 'moon', model: 'reefer' },
];
export const LOCO = 'loco';
export const GRAY = 'gray';
export const COLOR_IDS = CARD_COLORS.map((c) => c.id);
export const colorInfo = (id) =>
  CARD_COLORS.find((c) => c.id === id) ||
  (id === LOCO ? { id: LOCO, name: 'Locomotive', hex: '#ffffff', dark: '#000', shape: 'loco' } :
    { id: GRAY, name: 'Gray (any color)', hex: '#b4b4b4', dark: '#5a5a5a', shape: 'none' });

export const PLAYER_COLORS = [
  { id: 'red', name: 'Red', hex: '#ff2d2d' },
  { id: 'blue', name: 'Blue', hex: '#2f6bff' },
  { id: 'green', name: 'Green', hex: '#24c93c' },
  { id: 'yellow', name: 'Yellow', hex: '#ffd60a' },
  { id: 'pink', name: 'Pink', hex: '#ff5fc8' },
];

/** Points for claiming a route of a given length. Lengths beyond the table extrapolate. */
export const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 7: 18, 8: 21, 9: 27, 10: 30 };
export function routePoints(len) {
  if (ROUTE_POINTS[len] != null) return ROUTE_POINTS[len];
  return 30 + (len - 10) * 4;
}

export const RULES = {
  minPlayers: 2,
  maxPlayers: 5,
  cardsPerColor: 12,
  locomotives: 14,
  startingHand: 4,
  faceUpCount: 5,
  maxFaceUpLocos: 2, // 3+ face-up locomotives => discard all five and redeal
  initialTicketsDealt: 3,
  initialTicketsKeep: 2,
  ticketsDrawn: 3,
  ticketsKeep: 1,
  endTriggerTrains: 2, // a player at <= this many trains triggers the final round
  longestBonus: 10,
  doubleRoutesMinPlayers: 4, // below this, only one track of a double route can be used
};

export const SETTINGS_LIMITS = {
  trainsPerPlayer: { min: 20, max: 80, default: 45 },
  maxPlayers: { min: 2, max: 5, default: 4 },
  extraLocomotives: { min: 0, max: 20, default: 0 },
  extraCardsPerColor: { min: 0, max: 12, default: 0 },
};

export const MAX_LOBBIES = 12;
