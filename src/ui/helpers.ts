export function visibleLength(s: string): number {
  // strips ANSI escape codes before measuring
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function padRight(s: string, width: number, char = ' '): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? s + char.repeat(pad) : s;
}

export function padLeft(s: string, width: number, char = ' '): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? char.repeat(pad) + s : s;
}

export function center(s: string, width: number, char = ' '): string {
  const pad = width - visibleLength(s);
  if (pad <= 0) return s;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return char.repeat(left) + s + char.repeat(right);
}

export function receiptRow(label: string, value: string, width: number): string {
  const gap = width - visibleLength(label) - visibleLength(value);
  const dots = gap > 2 ? '·'.repeat(gap - 2) : '';
  return `${label} ${dots} ${value}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
