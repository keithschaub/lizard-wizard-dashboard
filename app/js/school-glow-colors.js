/** Bright school glow colors readable on the dark summon overlay (sampled from card art, tuned for mobile). */
export const SCHOOL_GLOW = {
  Sorcery: { hex: '#5eb0ff', pulse: [94, 176, 255], outer: [94, 176, 255] },
  Alchemy: { hex: '#ffc04a', pulse: [255, 192, 74], outer: [255, 192, 74] },
  Conjuring: { hex: '#ff6b4a', pulse: [255, 107, 74], outer: [255, 107, 74] },
  Druidry: { hex: '#5fd35f', pulse: [95, 211, 95], outer: [95, 211, 95] },
  Enchantment: { hex: '#f5f5ff', pulse: [245, 245, 255], outer: [245, 245, 255] },
  Necromancy: { hex: '#141418', pulse: [200, 200, 210], outer: [20, 20, 24] },
  Thaumaturgy: { hex: '#ffd23f', pulse: [255, 210, 63], outer: [255, 210, 63] },
};

export function schoolGlowTable() {
  return Object.fromEntries(Object.entries(SCHOOL_GLOW).map(([school, c]) => [school, c.hex]));
}