import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';

type LocalPeer = {
  messagingSocketPath?: string;
  name?: string;
  pid?: number;
};

type BridgePeer = {
  peerId: string;
  name?: string;
};

let localPeers: LocalPeer[] = [];
let remotePeers: BridgePeer[] = [];
const listPeers = mock(async () => localPeers);
const listBridgePeers = mock(async () => remotePeers);
const formatUdsAddress = mock((socketPath: string) => `uds:${socketPath}`);

mock.module('src/utils/udsClient.js', () => ({
  listPeers,
}));

mock.module('src/utils/udsMessaging.js', () => ({
  formatUdsAddress,
}));

mock.module('src/bridge/peerSessions.js', () => ({
  listBridgePeers,
}));

type ElementNode = React.ReactElement<{
  children?: React.ReactNode;
  color?: string;
  dimColor?: boolean;
}>;

function isElementNode(value: React.ReactNode): value is ElementNode {
  return React.isValidElement(value);
}

function childrenOf(node: React.ReactNode): React.ReactNode[] {
  if (!isElementNode(node)) return [];
  return React.Children.toArray(node.props.children);
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  return childrenOf(node).map(textContent).join('');
}

function findTextElement(node: React.ReactNode, predicate: (element: ElementNode) => boolean): ElementNode | undefined {
  if (isElementNode(node) && predicate(node)) return node;

  for (const child of childrenOf(node)) {
    const match = findTextElement(child, predicate);
    if (match) return match;
  }

  return undefined;
}

async function callPeers(onDone = mock(() => {})) {
  const { call } = await import('../peers.js');
  const rendered = await call(onDone, {} as never, '');
  return { rendered, onDone };
}

describe('/peers command', () => {
  beforeEach(() => {
    localPeers = [];
    remotePeers = [];
    listPeers.mockClear();
    listBridgePeers.mockClear();
    formatUdsAddress.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  test('renders an empty state when no peers are found', async () => {
    const { rendered } = await callPeers();

    expect(listPeers).toHaveBeenCalledTimes(1);
    expect(listBridgePeers).toHaveBeenCalledTimes(1);
    expect(textContent(rendered)).toContain('No peers found.');
  });

  test('merges local UDS peers and bridge peers with colored addresses and dim labels', async () => {
    localPeers = [
      {
        messagingSocketPath: '/tmp/claude-messaging-host-101.sock',
        name: 'local-one',
        pid: 101,
      },
      {
        messagingSocketPath: '/tmp/claude-messaging-host-202.sock',
        pid: 202,
      },
    ];
    remotePeers = [{ peerId: 'bridge:session_abc', name: 'remote-one' }, { peerId: 'bridge:session_def' }];

    const { rendered } = await callPeers();

    expect(formatUdsAddress).toHaveBeenCalledTimes(2);
    expect(formatUdsAddress).toHaveBeenNthCalledWith(1, '/tmp/claude-messaging-host-101.sock');
    expect(formatUdsAddress).toHaveBeenNthCalledWith(2, '/tmp/claude-messaging-host-202.sock');

    for (const address of [
      'uds:/tmp/claude-messaging-host-101.sock',
      'uds:/tmp/claude-messaging-host-202.sock',
      'bridge:session_abc',
      'bridge:session_def',
    ]) {
      const addressNode = findTextElement(
        rendered,
        element => element.props.color === 'ansi:cyan' && textContent(element) === address,
      );
      expect(addressNode).toBeDefined();
    }

    for (const label of ['local-one', 'pid:202', 'remote-one', 'bridge:session_def']) {
      const labelNode = findTextElement(
        rendered,
        element => element.props.dimColor === true && textContent(element).includes(label),
      );
      expect(labelNode).toBeDefined();
    }
  });

  test('defers completion until after render returns', async () => {
    const onDone = mock(() => {});

    await callPeers(onDone);

    expect(onDone).toHaveBeenCalledTimes(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
