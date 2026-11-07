/** Deploy stamp (overwritten on GitHub Pages build). Local default: "dev". */
export const BUILD = 'dev';
export const SHA = 'dev';
export const BUILT_AT = 'dev';

export function versionLabel() {
  if (BUILD === 'dev' && SHA === 'dev' && BUILT_AT === 'dev') return 'dev';
  return `v1.0.${BUILD} · ${SHA} · ${BUILT_AT}`;
}
