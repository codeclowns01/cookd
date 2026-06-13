import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { FAINT, INK } from '../theme.js';
import { CONTENT_WIDTH } from './Box.js';

interface BarcodeProps {
  handle: string;
  deviceId: string;
  linkedAt: Date;
  serialNumber: number;
}

export function Barcode({ handle, deviceId, linkedAt, serialNumber }: BarcodeProps): React.ReactElement {
  const bars = '▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌';
  const shortHandle = handle.slice(0, 4).toUpperCase();
  const serial = String(serialNumber).padStart(4, '0');
  const date = linkedAt.toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).toUpperCase();
  const machine = deviceId.slice(0, 8).toUpperCase();
  const filing = `N° ${serial}-${shortHandle} · ${machine} · ${date}`;

  return (
    <>
      <Text>{'  ' + chalk.hex(INK)(bars.slice(0, CONTENT_WIDTH))}</Text>
      <Text>{'  ' + chalk.hex(FAINT)(filing)}</Text>
    </>
  );
}
