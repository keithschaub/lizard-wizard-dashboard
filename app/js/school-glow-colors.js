/** Bright school glow colors readable on the dark summon overlay (sampled from card art, tuned for mobile). */
export const SCHOOL_GLOW = {
  Sorcery: { hex: '#5eb0ff', pulse: [94, 176, 255], outer: [94, 176, 255] },
  Alchemy: { hex: '#aa5ae6', pulse: [170, 90, 230], outer: [170, 90, 230] },
  Conjuring: { hex: '#e62828', pulse: [230, 40, 40], outer: [230, 40, 40] },
  Druidry: { hex: '#5fd35f', pulse: [95, 211, 95], outer: [95, 211, 95] },
  Enchantment: { hex: '#f5f5ff', pulse: [245, 245, 255], outer: [245, 245, 255] },
  Necromancy: { hex: '#08080a', pulse: [70, 70, 78], outer: [8, 8, 10] },
  Thaumaturgy: { hex: '#ffd23f', pulse: [255, 210, 63], outer: [255, 210, 63] },
};

export function schoolGlowTable() {
  return Object.fromEntries(Object.entries(SCHOOL_GLOW).map(([school, c]) => [school, c.hex]));
}