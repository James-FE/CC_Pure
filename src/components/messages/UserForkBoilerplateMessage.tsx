import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type { ReactNode } from 'react';
import { Box, Text } from '@anthropic/ink';
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js';

type ForkContentBlock = {
  type: string;
  text?: string;
};

type ForkMessageParam = {
  message: {
    content: ForkContentBlock[];
  };
};

type Props = {
  addMargin?: boolean;
  param?: TextBlockParam | ForkMessageParam;
};

function getTextBlocks(param: Props['param']): string[] {
  if (!param) return [];
  if ('text' in param) return [param.text];

  const content = param.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is ForkContentBlock & { text: string } => {
      return block.type === 'text' && typeof block.text === 'string';
    })
    .map(block => block.text);
}

function extractForkDirective(param: Props['param']): string | null {
  const boilerplateOpenTag = `<${FORK_BOILERPLATE_TAG}>`;
  const block = getTextBlocks(param).find(text => text.includes(boilerplateOpenTag));
  if (!block) return null;

  const directiveStart = block.indexOf(FORK_DIRECTIVE_PREFIX);
  if (directiveStart === -1) return null;

  const directive = block.slice(directiveStart + FORK_DIRECTIVE_PREFIX.length).trim();
  return directive || null;
}

export function UserForkBoilerplateMessage({ addMargin = false, param }: Props): ReactNode {
  const directive = extractForkDirective(param);
  if (!directive) return null;

  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text dimColor>Fork: {directive}</Text>
    </Box>
  );
}
