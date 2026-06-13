import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { FLAME, MUT, FAINT, INK } from '../theme.js';
import { padRight, receiptRow, visibleLength } from '../helpers.js';
import { BoxTop, BoxBottom, BoxDivider, BoxBlank, BoxRow, BoxRowRaw, CONTENT_WIDTH, INNER_WIDTH } from './Box.js';

interface ReceiptLine {
  label: string;
  value: string;
}

interface EditorialBlockProps {
  handle: string;
  headline: string[];
  aside: string;
  receiptLines: ReceiptLine[];
}

export function EditorialBlock({ handle, headline, aside, receiptLines }: EditorialBlockProps): React.ReactElement {
  const handleUpper = handle.toUpperCase();

  const masthead  = chalk.hex(INK).bold('THE COOKD PRESS');
  const section   = chalk.hex(FAINT)('OPINION — SCATHING');
  const headerRow = padRight(masthead + '          ' + section, CONTENT_WIDTH);

  const byline    = chalk.hex(FAINT)(`EDITOR'S COLUMN · TONIGHT'S SUBJECT: @${handleUpper}`);

  return (
    <>
      <BoxTop />
      <BoxRow children={'  ' + headerRow} />
      <BoxRow children={'  ' + byline} />
      <BoxDivider />
      <BoxBlank />
      {headline.map((line, i) => (
        <BoxRow key={i} children={'  ' + chalk.hex(FLAME).bold(line.toUpperCase())} />
      ))}
      <BoxBlank />
      <BoxRow children={'  ' + chalk.hex(MUT).italic('— ' + aside)} />
      <BoxDivider />
      {receiptLines.map((row, i) => (
        <BoxRow key={i} children={'  ' + chalk.hex(FAINT)(receiptRow(row.label, row.value, CONTENT_WIDTH - 4))} />
      ))}
    </>
  );
}
