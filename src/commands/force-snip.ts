import type { Command, LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async () => {
  return {
    type: 'text',
    value:
      'Use the Snip tool to remove messages from the conversation history. ' +
      'Provide the message IDs you want to snip and an optional reason. ' +
      'Snipped messages will be compacted on the next turn with a summary of removed content.',
  }
}

const forceSnip = {
  type: 'local',
  name: 'force-snip',
  description:
    'Guide for using the Snip tool to free up context space by removing older messages',
  isEnabled: () => true,
  supportsNonInteractive: true,
  isHidden: false,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default forceSnip
