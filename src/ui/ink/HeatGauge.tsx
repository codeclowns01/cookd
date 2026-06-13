import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { heat, FAINT } from '../theme.js';
import { CONTENT_WIDTH } from './Box.js';

interface HeatGaugeProps {
  ratio: number;
}

export function HeatGauge({ ratio: rawRatio }: HeatGaugeProps): React.ReactElement {
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const filled = Math.round(ratio * CONTENT_WIDTH);
  const empty  = CONTENT_WIDTH - filled;
  const color  = heat(ratio);

  const bar = chalk.hex(color)('█'.repeat(filled)) + chalk.hex(FAINT)('░'.repeat(empty));
  const pct  = `${Math.round(ratio * 100)}%  of limit torched`;
  const pctLine = ' '.repeat(Math.floor((CONTENT_WIDTH - pct.length) / 2)) + pct;

  return (
    <>
      <Text>{'  ' + bar}</Text>
      <Text>{'  ' + bar}</Text>
      <Text>{'  ' + bar}</Text>
      <Text>{'  ' + chalk.hex(color)(pctLine)}</Text>
    </>
  );
}
