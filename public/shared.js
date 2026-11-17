// Shared between server (authoritative) and client (prediction / rendering)
export const ARENA = 38;
export const SHOPS = [
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
  { x: 0, z: 22, w: 8, d: 2, h: 1.6, color: 0x6d4c41 },
];

export function resolve(x, z, r) {
  for (let i = 0; i < 2; i++) {
    for (const b of SHOPS) {
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

export function blocked(x, z) {
  for (const b of SHOPS) {
    if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true;
  }
  return Math.abs(x) > ARENA || Math.abs(z) > ARENA;
}

export const RULES = {
  ROUND: 150, ADVANCE: 5000, FACTOR: 1.35, HOLDBACK: 0.25,
  STACK_ADV: 3000, STACK_FACTOR: 1.45, STACK_HB: 0.05, SPEED: 7.5,
};
