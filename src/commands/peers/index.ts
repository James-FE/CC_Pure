import type { Command } from '../../commands.js'

const peers: Command = {
  type: 'local-jsx',
  name: 'peers',
  description:
    'List connected Claude Code peers (local UDS + Remote Control bridge)',
  isEnabled: () => true,
  load: () => import('./peers.js'),
}

export default peers
