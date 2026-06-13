import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { FAINT, INK } from '../theme.js';
import { padRight } from '../helpers.js';

export const BOX_WIDTH    = 52;
export const INNER_WIDTH  = 50;
export const CONTENT_WIDTH = 46;

const DL = chalk.hex(FAINT);

export function BoxTop(): React.ReactElement {
  return <Text>{DL('╔' + '═'.repeat(INNER_WIDTH) + '╗')}</Text>;
}

export function BoxBottom(): React.ReactElement {
  return <Text>{DL('╚' + '═'.repeat(INNER_WIDTH) + '╝')}</Text>;
}

export function BoxDivider(): React.ReactElement {
  return <Text>{DL('╠' + '═'.repeat(INNER_WIDTH) + '╣')}</Text>;
}

export function BoxBlank(): React.ReactElement {
  return <Text>{DL('║') + ' '.repeat(INNER_WIDTH) + DL('║')}</Text>;
}

export function BoxRow({ children }: { children: string }): React.ReactElement {
  const padded = padRight(children, CONTENT_WIDTH);
  return <Text>{DL('║') + '  ' + padded + '  ' + DL('║')}</Text>;
}

export function BoxRowRaw({ left, right }: { left: string; right: string }): React.ReactElement {
  const content = left + right;
  const padded = padRight(content, CONTENT_WIDTH);
  return <Text>{DL('║') + '  ' + padded + '  ' + DL('║')}</Text>;
}
