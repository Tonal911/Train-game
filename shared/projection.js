// Lambert conformal conic projection tuned for southern Canada + continental US.
// Board space: x right, y down, BOARD_W wide. Shared by server, client, editor and scripts.

const D = Math.PI / 180;
const PHI1 = 33 * D, PHI2 = 45 * D, PHI0 = 40 * D, LAM0 = -96 * D;
const N = Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2));
const F = (Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), N)) / N;
const RHO0 = F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), N);

function rawForward(lon, lat) {
  const rho = F / Math.pow(Math.tan(Math.PI / 4 + (lat * D) / 2), N);
  const th = N * (lon * D - LAM0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}

function rawInverse(x, y) {
  const dy = RHO0 - y;
  const rho = Math.sign(N) * Math.sqrt(x * x + dy * dy);
  const th = Math.atan2(x, dy);
  const lat = 2 * Math.atan(Math.pow(F / rho, 1 / N)) - Math.PI / 2;
  const lon = LAM0 + th / N;
  return [lon / D, lat / D];
}

// Frame: west edge just past Vancouver Island, east edge past Halifax,
// south edge below Miami, north edge above Edmonton.
const FRAME_POINTS = [
  [-127.5, 49.5], [-125.5, 40.5], [-119, 31.5], [-61.0, 45.5], [-63, 47.5],
  [-80.5, 23.6], [-97.5, 24.8], [-114, 55.8], [-75, 49.2],
];
let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
for (const [lon, lat] of FRAME_POINTS) {
  const [x, y] = rawForward(lon, lat);
  xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
  ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
}

export const BOARD_W = 4000;
const SCALE = BOARD_W / (xmax - xmin);
export const BOARD_H = Math.round((ymax - ymin) * SCALE);

/** lon/lat (degrees) -> board [x, y] */
export function project(lon, lat) {
  const [x, y] = rawForward(lon, lat);
  return [(x - xmin) * SCALE, (ymax - y) * SCALE];
}

/** board [x, y] -> [lon, lat] */
export function unproject(bx, by) {
  return rawInverse(bx / SCALE + xmin, ymax - by / SCALE);
}

export function inBoard(x, y, margin = 0) {
  return x >= margin && y >= margin && x <= BOARD_W - margin && y <= BOARD_H - margin;
}

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * D, dLon = (lon2 - lon1) * D;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
