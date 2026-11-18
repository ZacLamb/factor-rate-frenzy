// Shared between server (authoritative) and client (prediction / rendering)
export const ARENA = 38;
// ---- Maps: obstacle layout + look + rules. Server and client both read this. ----
const MAIN_SHOPS = [
  { x: -21, z: -21, w: 12, d: 8, h: 5, color: 0xe4572e, label: 'DINER', awning: 0xffffff },
  { x: 21, z: -21, w: 12, d: 8, h: 5, color: 0x3a86ff, label: 'HAIR SALON', awning: 0xffd166 },
  { x: -21, z: 21, w: 12, d: 8, h: 5, color: 0xffa62b, label: 'TACO TRUCK', awning: 0x06d6a0 },
  { x: 21, z: 21, w: 12, d: 8, h: 5, color: 0x2ec4b6, label: 'LAUNDROMAT', awning: 0xef476f },
  { x: 0, z: 0, w: 7, d: 7, h: 15, color: 0x20202c, label: 'LENDER HQ', hq: true },
  { x: -9, z: -10, w: 3, d: 3, h: 2.2, color: 0x8d6e63 },
  { x: 9, z: 10, w: 3, d: 3, h: 2.2, color: 0x8d6e63 },
  { x: 10, z: -9, w: 3, d: 6, h: 1.6, color: 0x607d8b },
  { x: -10, z: 9, w: 3, d: 6, h: 1.6, color: 0x607d8b },
  { x: 0, z: -22, w: 8, d: 2, h: 1.6, color: 0x6d4c41 },
  { x: 33, z: 33, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: -33, z: 33, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: 33, z: -33, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: -33, z: -33, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: 34, z: 0, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: -34, z: 0, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true },
  { x: 0, z: 22, w: 8, d: 2, h: 1.6, color: 0x6d4c41 },
];
const rules = (o = {}) => ({ coinVal: 1, coinRate: 1, stackEvery: 11, stackCap: 2, powEvery: 8, powW: [1, 1, 1], hbZone: null, rush: null, rain: false, ...o });
const wall = (x, z, w, d, h = 3.2, color = 0x8a4b5a) => ({ x, z, w, d, h, color });
const stall = (x, z, color, awning) => ({ x, z, w: 4.2, d: 3, h: 2.4, color, awning, stall: true });
const planters = [[33, 33], [-33, 33], [33, -33], [-33, -33], [34, 0], [-34, 0]].map(([x, z]) => ({ x, z, w: 3.6, d: 3.6, h: 1.3, color: 0x8a7898, planter: true }));
export const MAPS = {
  main: {
    name: 'Main Street', icon: '🏙', blurb: 'The classic brawl. Four shops, one lender tower.',
    lesson: 'Main Street: the standard mix. The holdback is a fixed share of every sale, so strong weeks repay faster.',
    shops: MAIN_SHOPS, rules: rules(),
    theme: { sky: ['#16307a', '#8a4aa8', '#ff9a5e'], fog: 0x5a4290, hemi: [0xd6ecff, 0x7a5a8a, 1.25], sun: [0xffc88a, 2.1], ground: 0xffffff, neon: 0x35e8ff, exposure: 1.3, plaza: true },
  },
  tower: {
    name: 'Lender Tower', icon: '🏦', blurb: 'Big HQ in the middle. Sales near it get swept harder.',
    lesson: 'Lender Tower: a higher holdback % pays the advance down faster but squeezes your daily cash. Always check the holdback % before you sign.',
    shops: [{ x: 0, z: 0, w: 10, d: 10, h: 20, color: 0x2d2850, label: 'LENDER HQ', hq: true },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: Math.round(Math.cos(i * Math.PI / 4) * 19), z: Math.round(Math.sin(i * Math.PI / 4) * 19), w: 2.6, d: 2.6, h: 3, color: 0x6a3a7a })),
      { x: -28, z: 0, w: 5, d: 8, h: 4, color: 0xe4572e, label: 'DINER', awning: 0xffffff }, { x: 28, z: 0, w: 5, d: 8, h: 4, color: 0x3a86ff, label: 'SALON', awning: 0xffd166 },
      ...planters],
    rules: rules({ hbZone: { x: 0, z: 0, r: 17, mult: 1.4 }, coinRate: 1.15 }),
    theme: { sky: ['#2a0a2e', '#7a1f4a', '#ff6a4a'], fog: 0x6a2650, hemi: [0xffc0c0, 0x5a2a5a, 1.1], sun: [0xff9a6a, 1.8], ground: 0xcfa0b8, neon: 0xff3d6e, exposure: 1.25, plaza: true },
  },
  slow: {
    name: 'Slow Season', icon: '🌧', blurb: 'Rainy, quiet streets. Fewer sales, more Holdback Holidays.',
    lesson: 'Slow Season: with a holdback, payments shrink when sales dip, but the total payback never changes. It just takes longer.',
    shops: [...MAIN_SHOPS.filter((b) => !b.planter), ...planters.slice(0, 4)],
    rules: rules({ coinVal: 0.75, coinRate: 0.6, powW: [1, 1, 4], powEvery: 6, rain: true }),
    theme: { sky: ['#0b1a2e', '#24405e', '#5a7a96'], fog: 0x2e4560, hemi: [0x9fc4e8, 0x405a78, 1.0], sun: [0xbcd4ff, 1.1], ground: 0x8fa4c8, neon: 0x6ab7ff, exposure: 1.1, plaza: true },
  },
  alley: {
    name: 'Stacking Alley', icon: '🧱', blurb: 'Narrow lanes full of tempting STACK offers.',
    lesson: 'Stacking Alley: stacking looks like easy cash, but each new advance adds a full payback and a bigger holdback on top of the old one.',
    shops: [{ x: 0, z: 0, w: 6, d: 6, h: 12, color: 0x2d2850, label: 'LENDER HQ', hq: true },
      wall(-17, -13, 20, 2.4), wall(17, -13, 20, 2.4), wall(-17, 13, 20, 2.4), wall(17, 13, 20, 2.4),
      wall(-27, 0, 2.4, 14), wall(27, 0, 2.4, 14), wall(-9, -27, 2.4, 12), wall(9, -27, 2.4, 12), wall(-9, 27, 2.4, 12), wall(9, 27, 2.4, 12),
      ...planters.slice(0, 4)],
    rules: rules({ stackEvery: 3.5, stackCap: 6, coinRate: 0.9 }),
    theme: { sky: ['#0a0820', '#20184a', '#7a3a5a'], fog: 0x2a1f48, hemi: [0xc8b8ff, 0x5a4a78, 1.2], sun: [0xffa86e, 1.7], ground: 0xb8aed0, neon: 0xff5ec8, exposure: 1.25, plaza: false },
  },
  market: {
    name: 'Open Market', icon: '🎪', blurb: 'A festival plaza. Busy-season rushes boost sales.',
    lesson: 'Open Market: in a busy season your sales (and holdback payments) jump, so you repay sooner. With a fixed factor the cost stays the same, which makes the APR higher.',
    shops: [stall(-12, -12, 0xe4572e, 0xffffff), stall(12, -12, 0x2ec4b6, 0xffd166), stall(-12, 12, 0x3a86ff, 0xef476f), stall(12, 12, 0xffa62b, 0x06d6a0),
      stall(-26, -6, 0xef476f, 0xffffff), stall(26, 6, 0x8ac926, 0xffffff), stall(-6, -27, 0xffa62b, 0xffffff), stall(6, 27, 0x3a86ff, 0xffffff),
      { x: 0, z: 0, w: 6, d: 6, h: 1.2, color: 0x2fb0c0, fountain: true }, ...planters],
    rules: rules({ rush: { every: 40, dur: 15 }, coinRate: 1.1 }),
    theme: { sky: ['#1c3f8f', '#c24f9e', '#ffb347'], fog: 0x8a5aa0, hemi: [0xfff0d0, 0x9a6a80, 1.35], sun: [0xffd08a, 2.3], ground: 0xffe2c4, neon: 0xffd23d, exposure: 1.35, plaza: true },
  },
};
export const MAP_IDS = Object.keys(MAPS);
export let ACTIVE_SHOPS = MAPS.main.shops;
export function setActiveMap(id) { ACTIVE_SHOPS = (MAPS[id] || MAPS.main).shops; }
export const SHOPS = MAPS.main.shops;

export function resolve(x, z, r, shops = ACTIVE_SHOPS) {
  for (let i = 0; i < 2; i++) {
    for (const b of shops) {
      const hw = b.w / 2, hd = b.d / 2;
      const cx = Math.max(b.x - hw, Math.min(x, b.x + hw));
      const cz = Math.max(b.z - hd, Math.min(z, b.z + hd));
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        const px = hw - Math.abs(x - b.x), pz = hd - Math.abs(z - b.z);
        if (px < pz) x = b.x + Math.sign(x - b.x || 1) * (hw + r);
        else z = b.z + Math.sign(z - b.z || 1) * (hd + r);
      }
    }
  }
  const lim = ARENA - r;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
}

export function blocked(x, z, shops = ACTIVE_SHOPS) {
  for (const b of shops) {
    if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true;
  }
  return Math.abs(x) > ARENA || Math.abs(z) > ARENA;
}

export const RULES = {
  ROUND: 150, ADVANCE: 5000, FACTOR: 1.35, HOLDBACK: 0.25,
  STACK_ADV: 3000, STACK_FACTOR: 1.45, STACK_HB: 0.05, SPEED: 7.5,
};

/* ---- Career progression: "Top Rep" ranks ---- */
export const RANKS = [
  { n: 'Intern Rep', xp: 0, i: '🧑‍💼', perk: 'Learning the ropes' },
  { n: 'Sales Rep', xp: 200, i: '📞', perk: '+5% move speed' },
  { n: 'Closer', xp: 600, i: '🤝', perk: '+5% sales per coin' },
  { n: 'Senior Rep', xp: 1300, i: '💼', perk: 'Notices recharge 10% faster' },
  { n: 'Account Exec', xp: 2300, i: '🏆', perk: '+$500 starting cash, Surge recharges 2s faster' },
  { n: 'Top Rep', xp: 3600, i: '👑', perk: '+5% more sales, gold crown & name' },
];
export function levelFor(xp) { let l = 0; for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) l = i; return l; }
export function perks(l) {
  return { speed: l >= 1 ? 1.05 : 1, sales: 1 + (l >= 2 ? 0.05 : 0) + (l >= 5 ? 0.05 : 0), fire: l >= 3 ? 0.9 : 1, surgeCd: l >= 4 ? 2 : 0, startCash: l >= 4 ? 500 : 0 };
}
