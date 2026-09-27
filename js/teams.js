// Parrilla ficticia con las abreviaturas reales de la parrilla 2026 (22 pilotos, 11 equipos). Coche = equipo; piloto = habilidades + cerebro que aprende.
// power: kW · aero: carga relativa · grip: agarre mecánico relativo · drag: resistencia relativa
export const TEAMS = [
  { id: 'aur', name: 'Aurora Racing',      short: 'AURORA',  c1: '#1B2A6B', c2: '#E4002B', c3: '#FFC906', power: 768, aero: 1.035, grip: 1.012, drag: 1.00, crew: 2.25, rel: 0.999 },
  { id: 'ros', name: 'Scuderia Rosso',     short: 'ROSSO',   c1: '#D40000', c2: '#FFE100', c3: '#111111', power: 770, aero: 1.025, grip: 1.008, drag: 1.01, crew: 2.45, rel: 0.998 },
  { id: 'ste', name: 'Stellar GP',         short: 'STELLAR', c1: '#C9CED3', c2: '#00C4B0', c3: '#101418', power: 766, aero: 1.028, grip: 1.010, drag: 0.99, crew: 2.35, rel: 0.999 },
  { id: 'tan', name: 'Tangerine Motorsport', short: 'TANGERINE', c1: '#FF7A00', c2: '#1A2340', c3: '#47C7FC', power: 764, aero: 1.032, grip: 1.009, drag: 1.00, crew: 2.30, rel: 0.999 },
  { id: 'eme', name: 'Emerald Racing',     short: 'EMERALD', c1: '#0A5C45', c2: '#C8E000', c3: '#F4F4F4', power: 762, aero: 1.012, grip: 1.001, drag: 1.00, crew: 2.55, rel: 0.998 },
  { id: 'ble', name: 'Bleu Racing',        short: 'BLEU',    c1: '#0A8BF0', c2: '#FF7EB9', c3: '#0B1B3A', power: 758, aero: 1.006, grip: 0.998, drag: 1.00, crew: 2.60, rel: 0.997 },
  { id: 'oxf', name: 'Oxford GP',          short: 'OXFORD',  c1: '#0B2A5B', c2: '#34B6F0', c3: '#FFFFFF', power: 764, aero: 0.992, grip: 0.994, drag: 0.97, crew: 2.70, rel: 0.997 },
  { id: 'stl', name: 'Steel Formula',      short: 'STEEL',   c1: '#EDEDED', c2: '#E3002A', c3: '#1C1C1C', power: 760, aero: 0.998, grip: 0.996, drag: 1.00, crew: 2.75, rel: 0.996 },
  { id: 'nov', name: 'Nova Racing',        short: 'NOVA',    c1: '#5E86FF', c2: '#FFFFFF', c3: '#0E1A45', power: 768, aero: 1.004, grip: 0.999, drag: 1.00, crew: 2.40, rel: 0.998 },
  { id: 'kin', name: 'Kinetic F1',         short: 'KINETIC', c1: '#141414', c2: '#20E83B', c3: '#8A8A8A', power: 758, aero: 0.990, grip: 0.992, drag: 1.00, crew: 2.85, rel: 0.996 },
  { id: 'lib', name: 'Liberty GP',         short: 'LIBERTY', c1: '#F2F2F2', c2: '#0F1F3D', c3: '#C9A13B', power: 756, aero: 0.984, grip: 0.990, drag: 1.01, crew: 2.90, rel: 0.995 },
];

// pace: velocidad pura · craft: pelea en pista · agg: agresividad · cons: consistencia
// tyre: gestión de neumáticos · learn: ritmo de aprendizaje · know: trazada de partida
export const DRIVERS = [
  { code: 'VER', first: 'Marco',   last: 'Verano',     num: 3,  team: 'aur', helmet: '#F2C200', pace: 0.97, craft: 0.95, agg: 0.91, cons: 0.93, tyre: 0.88, learn: 0.95, know: 0.80 },
  { code: 'HAD', first: 'Isaac',   last: 'Haddad',     num: 6,  team: 'aur', helmet: '#FFFFFF', pace: 0.84, craft: 0.78, agg: 0.68, cons: 0.82, tyre: 0.75, learn: 0.80, know: 0.60 },
  { code: 'LEC', first: 'Luca',    last: 'Leclair',    num: 16, team: 'ros', helmet: '#FFFFFF', pace: 0.95, craft: 0.86, agg: 0.78, cons: 0.85, tyre: 0.80, learn: 0.90, know: 0.75 },
  { code: 'HAM', first: 'Lewis',   last: 'Hamden',     num: 44, team: 'ros', helmet: '#8B2CF5', pace: 0.94, craft: 0.97, agg: 0.80, cons: 0.92, tyre: 0.95, learn: 0.84, know: 0.85 },
  { code: 'RUS', first: 'George',  last: 'Russo',      num: 63, team: 'ste', helmet: '#0A2E6E', pace: 0.91, craft: 0.82, agg: 0.76, cons: 0.87, tyre: 0.84, learn: 0.88, know: 0.70 },
  { code: 'ANT', first: 'Andrea',  last: 'Antonetti',  num: 12, team: 'ste', helmet: '#2A6BFF', pace: 0.90, craft: 0.88, agg: 0.72, cons: 0.90, tyre: 0.92, learn: 0.85, know: 0.72 },
  { code: 'NOR', first: 'Lando',   last: 'Norrell',    num: 1,  team: 'tan', helmet: '#E9FF3B', pace: 0.94, craft: 0.84, agg: 0.74, cons: 0.86, tyre: 0.86, learn: 0.92, know: 0.72 },
  { code: 'PIA', first: 'Oscar',   last: 'Piastro',    num: 81, team: 'tan', helmet: '#F7F7F7', pace: 0.92, craft: 0.87, agg: 0.66, cons: 0.91, tyre: 0.87, learn: 0.93, know: 0.70 },
  { code: 'ALO', first: 'Fernando',last: 'Alonzo',     num: 14, team: 'eme', helmet: '#1E3FFF', pace: 0.90, craft: 0.99, agg: 0.88, cons: 0.94, tyre: 0.96, learn: 0.78, know: 0.90 },
  { code: 'STR', first: 'Lance',   last: 'Stroud',     num: 18, team: 'eme', helmet: '#C9DDFF', pace: 0.78, craft: 0.72, agg: 0.70, cons: 0.76, tyre: 0.80, learn: 0.70, know: 0.58 },
  { code: 'GAS', first: 'Pierre',  last: 'Gasquet',    num: 10, team: 'ble', helmet: '#15317E', pace: 0.86, craft: 0.83, agg: 0.72, cons: 0.85, tyre: 0.82, learn: 0.80, know: 0.68 },
  { code: 'COL', first: 'Franco',  last: 'Colomba',    num: 43, team: 'ble', helmet: '#8FD3FF', pace: 0.83, craft: 0.76, agg: 0.90, cons: 0.72, tyre: 0.74, learn: 0.90, know: 0.50 },
  { code: 'ALB', first: 'Alex',    last: 'Albion',     num: 23, team: 'oxf', helmet: '#F24B1A', pace: 0.88, craft: 0.86, agg: 0.68, cons: 0.90, tyre: 0.88, learn: 0.80, know: 0.74 },
  { code: 'SAI', first: 'Carlos',  last: 'Sainte',     num: 55, team: 'oxf', helmet: '#FFD400', pace: 0.89, craft: 0.90, agg: 0.76, cons: 0.91, tyre: 0.90, learn: 0.82, know: 0.76 },
  { code: 'OCO', first: 'Esteban', last: 'Ocampo',     num: 31, team: 'stl', helmet: '#FF4FA0', pace: 0.84, craft: 0.80, agg: 0.92, cons: 0.83, tyre: 0.80, learn: 0.76, know: 0.66 },
  { code: 'BEA', first: 'Ollie',   last: 'Bearden',    num: 87, team: 'stl', helmet: '#FFFFFF', pace: 0.84, craft: 0.78, agg: 0.78, cons: 0.80, tyre: 0.78, learn: 0.92, know: 0.52 },
  { code: 'LAW', first: 'Liam',    last: 'Lawton',     num: 30, team: 'nov', helmet: '#0D0D0D', pace: 0.83, craft: 0.80, agg: 0.86, cons: 0.80, tyre: 0.78, learn: 0.86, know: 0.55 },
  { code: 'LIN', first: 'Arvid',   last: 'Lindahl',    num: 41, team: 'nov', helmet: '#FF2D55', pace: 0.87, craft: 0.78, agg: 0.94, cons: 0.76, tyre: 0.76, learn: 0.85, know: 0.62 },
  { code: 'HUL', first: 'Nico',    last: 'Hulkamp',    num: 27, team: 'kin', helmet: '#FFE600', pace: 0.85, craft: 0.84, agg: 0.70, cons: 0.90, tyre: 0.86, learn: 0.72, know: 0.78 },
  { code: 'BOR', first: 'Gabriel', last: 'Bortello',   num: 5,  team: 'kin', helmet: '#00B3FF', pace: 0.82, craft: 0.74, agg: 0.76, cons: 0.78, tyre: 0.76, learn: 0.94, know: 0.48 },
  { code: 'PER', first: 'Sergio',  last: 'Peralta',    num: 11, team: 'lib', helmet: '#1B6BFF', pace: 0.85, craft: 0.88, agg: 0.76, cons: 0.82, tyre: 0.93, learn: 0.74, know: 0.82 },
  { code: 'BOT', first: 'Valtteri',last: 'Botvid',     num: 77, team: 'lib', helmet: '#7FD4FF', pace: 0.86, craft: 0.80, agg: 0.64, cons: 0.90, tyre: 0.86, learn: 0.74, know: 0.84 },
];

export const COMPOUNDS = {
  S: { name: 'SOFT',   letter: 'S', color: '#FF2E2E', grip: 0.994, wear: 1.78, warm: 1.35 },   // (24/09: equilibrados con estadística de carrera)
  M: { name: 'MEDIUM', letter: 'M', color: '#FFD12E', grip: 0.983, wear: 1.00, warm: 1.00 },
  H: { name: 'HARD',   letter: 'H', color: '#F2F2F2', grip: 0.971, wear: 0.60, warm: 0.80 },
  // lluvia: su agarre depende del agua en pista (ver wetGrip en sim.js)
  I: { name: 'INTER',  letter: 'I', color: '#35C759', grip: 1, wear: 0.9, warm: 1.25, wet: true },
  W: { name: 'LLUVIA', letter: 'W', color: '#2E7BFF', grip: 1, wear: 0.75, warm: 1.3, wet: true },
};

export const teamById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

// cada fin de semana (cada Sim) reparte al azar los coches entre equipos y learn/know entre pilotos:
// mismos valores de siempre, distinto dueño (25/09: nada fijo, que no gane siempre el mismo)
const CAR_KEYS = ['power', 'aero', 'grip', 'drag', 'crew', 'rel'];
const CARS0 = TEAMS.map((t) => Object.fromEntries(CAR_KEYS.map((k) => [k, t[k]])));
const LEARN0 = DRIVERS.map((d) => d.learn), KNOW0 = DRIVERS.map((d) => d.know);
const shuffled = (a, rng) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function shuffleWeekend(rng) {
  shuffled(CARS0, rng).forEach((c, i) => Object.assign(TEAMS[i], c));
  const L = shuffled(LEARN0, rng), K = shuffled(KNOW0, rng);
  DRIVERS.forEach((d, i) => { d.learn = L[i]; d.know = K[i]; });
}
