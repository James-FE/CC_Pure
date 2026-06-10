import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';

type PeerDisplay = {
  address: string;
  label: string;
};

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  _args?: string,
): Promise<React.ReactNode> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const udsClient = require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js');
  const udsMessaging = require('src/utils/udsMessaging.js') as typeof import('src/utils/udsMessaging.js');
  const bridgePeers = require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const localPeers = await udsClient.listPeers();
  const remotePeers = await bridgePeers.listBridgePeers();
  const peers: PeerDisplay[] = [
    ...localPeers.map(peer => ({
      address: peer.messagingSocketPath ? udsMessaging.formatUdsAddress(peer.messagingSocketPath) : 'unknown',
      label: peer.name ?? (peer.pid ? `pid:${peer.pid}` : 'unknown'),
    })),
    ...remotePeers.map(peer => ({
      address: peer.peerId,
      label: peer.name ?? peer.peerId,
    })),
  ];

  setTimeout(() => onDone(), 0);

  if (peers.length === 0) {
    return <Text dimColor>No peers found.</Text>;
  }

  return (
    <Box flexDirection="column">
      {peers.map(peer => (
        <Text key={`${peer.address}:${peer.label}`}>
          <Text color="ansi:cyan">{peer.address}</Text>
          <Text dimColor> ({peer.label})</Text>
        </Text>
      ))}
    </Box>
  );
}
