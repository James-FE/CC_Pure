import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import type { LocalJSXCommandContext } from '../../types/command.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';

export async function call(onDone: LocalJSXCommandOnDone, _context: LocalJSXCommandContext): Promise<React.ReactNode> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const udsClient = require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js');
  const udsMessaging = require('src/utils/udsMessaging.js') as typeof import('src/utils/udsMessaging.js');
  const bridgePeers = require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const peers = await udsClient.listPeers();
  const bridgePeerList = await bridgePeers.listBridgePeers();

  const allPeers = [
    ...peers.map(p => ({
      address: p.messagingSocketPath ? udsMessaging.formatUdsAddress(p.messagingSocketPath) : 'unknown',
      label: p.name ?? (p.pid ? `pid:${p.pid}` : 'unknown'),
      kind: 'local',
    })),
    ...bridgePeerList.map(p => ({
      address: p.peerId,
      label: p.name ?? p.peerId,
      kind: 'bridge',
    })),
  ];

  // Auto-close after rendering
  setTimeout(() => onDone(), 0);

  if (allPeers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No peers found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Peers ({allPeers.length})</Text>
      {allPeers.map((peer, i) => (
        <Box key={i} flexDirection="column">
          <Text>
            <Text color="ansi:cyan">{peer.address}</Text>
            {peer.label !== peer.address && <Text dimColor> ({peer.label})</Text>}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
