import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { MORGUE, FAINT } from '../theme.js';

interface OffenseTagsProps {
  tags: string[];
}

export function OffenseTags({ tags }: OffenseTagsProps): React.ReactElement {
  const rendered = tags
    .map(t => chalk.hex(FAINT)('[') + chalk.hex(MORGUE)(' ' + t.toUpperCase() + ' ') + chalk.hex(FAINT)(']'))
    .join('  ');

  return <Text>{'  ' + rendered}</Text>;
}
