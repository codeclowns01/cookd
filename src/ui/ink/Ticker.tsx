import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { FLAME, STAMP, INK } from '../theme.js';
import { BOX_WIDTH } from './Box.js';

const TICKER_CONTENT: Record<string, string> = {
  'cold-open':   '★ THE ONLY PAPER THAT PRINTS YOUR FAILURES ★ DEVELOPING STORY ★ THE ONLY PAPER THAT PRINTS YOUR FAILURES ★ DEVELOPING STORY ★',
  'reading':     '★ THE ONLY PAPER THAT PRINTS YOUR FAILURES ★ DEVELOPING STORY ★ THE ONLY PAPER THAT PRINTS YOUR FAILURES ★ DEVELOPING STORY ★',
  'cooking':     '★ DEVELOPING STORY ★ SOURCES SAY ONE MORE FIX ★ STILL COOKING ★ DEVELOPING STORY ★ SOURCES SAY ONE MORE FIX ★ STILL COOKING ★',
  'press-code':  '★ PRESS CREDENTIALS REQUIRED ★ ENTER CODE IN APP ★ NO EMAIL ★ NO PASSWORD ★ NO TOURISTS ★ PRESS CREDENTIALS REQUIRED ★ ENTER CODE IN APP ★',
  'success':     '★ WELCOME TO THE PAPER ★ FIELD REPORTER ON DUTY ★ YOUR SENTENCE STARTS NOW ★ MACHINE DEPUTIZED ★ WELCOME TO THE PAPER ★',
  'already-linked': '★ ALREADY FILED ★ YOU\'RE ON RECORD ★ THE EDITOR KEEPS EVERYTHING ★ ALREADY FILED ★ YOU\'RE ON RECORD ★',
  'no-data':     '★ PRESS CLOSED ★ NO EDITION TODAY ★ COME BACK WHEN YOU\'VE COOKED SOMETHING ★ GRASS: UNTOUCHED ★',
  'error':       '★ TRANSMISSION FAILURE ★ THE PRESSES HAVE STOPPED ★ STAND BY ★ TRANSMISSION FAILURE ★ THE PRESSES HAVE STOPPED ★',
};

const BG_FLAME = ['success', 'already-linked', 'no-data'];

interface TickerProps {
  state: string;
  handle?: string;
  tokenSummary?: string;
}

export function Ticker({ state, handle, tokenSummary }: TickerProps): React.ReactElement {
  const [offset, setOffset] = useState(0);

  let content = TICKER_CONTENT[state] ?? TICKER_CONTENT['cold-open'];
  if (state === 'cooked' && handle && tokenSummary) {
    const raw = `★ TONIGHT'S TOP STORY ★ @${handle.toUpperCase()} HITS 100% — AGAIN ★ ${tokenSummary} ★ TONIGHT'S TOP STORY ★ @${handle.toUpperCase()} HITS 100% — AGAIN ★ ${tokenSummary} ★`;
    content = raw;
  }

  const doubled = content + '  ' + content;
  const useBg = BG_FLAME.includes(state);
  const bgColor = useBg ? STAMP : FLAME;
  const fgColor = INK;

  useEffect(() => {
    const timer = setInterval(() => {
      setOffset(o => (o + 1) % (content.length + 2));
    }, 80);
    return () => clearInterval(timer);
  }, [content]);

  const visible = doubled.slice(offset, offset + BOX_WIDTH);
  const styled = chalk.bgHex(bgColor).hex(fgColor).bold(visible);

  return <Text>{styled}</Text>;
}
