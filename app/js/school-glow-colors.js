/** Glow / blink colors sampled from each school's familiar (or wizard) card frame art. */
export const SCHOOL_GLOW = {
  Sorcery: { hex: '#71a4e5', pulse: [113, 164, 229], outer: [55, 130, 210] },
  Alchemy: { hex: '#fed268', pulse: [254, 210, 104], outer: [200, 150, 60] },
  Conjuring: { hex: '#ff7a3f', pulse: [255, 122, 63], outer: [200, 80, 40] },
  Druidry: { hex: '#427a2c', pulse: [66, 122, 44], outer: [90, 160, 70] },
  Enchantment: { hex: '#ebb664', pulse: [235, 182, 100], outer: [190, 130, 70] },
  Necromancy: { hex: '#3167b2', pulse: [49, 103, 178], outer: [90, 140, 200] },
  Thaumaturgy: { hex: '#fb9e13', pulse: [251, 158, 19], outer: [220, 120, 30] },
};

export function schoolGlowTable() {
  return Object.fromEntries(Object.entries(SCHOOL_GLOW).map(([school, c]) => [school, c.hex]));
}