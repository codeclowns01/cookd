import chalk from 'chalk';

export const FLAME  = '#FF4D00';
export const STAMP  = '#FFC400';
export const MORGUE = '#7FA7C4';
export const INK    = '#F2EAD9';
export const MUT    = '#8D8377';
export const FAINT  = '#5D564C';

export const flame  = chalk.hex(FLAME);
export const stamp  = chalk.hex(STAMP);
export const morgue = chalk.hex(MORGUE);
export const ink    = chalk.hex(INK);
export const mut    = chalk.hex(MUT);
export const faint  = chalk.hex(FAINT);

export function heat(ratio: number): string {
  const r0 = [255, 77,  0];
  const r1 = [255, 196, 0];
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(r0[0] + (r1[0] - r0[0]) * t);
  const g = Math.round(r0[1] + (r1[1] - r0[1]) * t);
  const b = Math.round(r0[2] + (r1[2] - r0[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
