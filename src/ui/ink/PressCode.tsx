import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { STAMP, FAINT, INK } from '../theme.js';

interface PressCodeProps {
  code: string;
}

export function PressCode({ code }: PressCodeProps): React.ReactElement {
  const chars = code.toUpperCase().padEnd(6, ' ').slice(0, 6).split('');
  const top    = chars.map(() => chalk.hex(FAINT)('┌────┐')).join('  ');
  const mid    = chars.map(c => chalk.hex(FAINT)('│') + '  ' + chalk.hex(STAMP).bold(c) + ' ' + chalk.hex(FAINT)('│')).join('  ');
  const bot    = chars.map(() => chalk.hex(FAINT)('└────┘')).join('  ');

  return (
    <>
      <Text>{'  ' + top}</Text>
      <Text>{'  ' + mid}</Text>
      <Text>{'  ' + bot}</Text>
    </>
  );
}
