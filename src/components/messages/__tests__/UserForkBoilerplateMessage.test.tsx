import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../../constants/xml.js';
import { UserForkBoilerplateMessage } from '../UserForkBoilerplateMessage.js';

function collectText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join('');
  }
  if (React.isValidElement(node)) {
    return collectText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

describe('UserForkBoilerplateMessage', () => {
  test('renders only the fork directive from a boilerplate content block', () => {
    const node = UserForkBoilerplateMessage({
      addMargin: true,
      param: {
        message: {
          content: [
            { type: 'text', text: 'unrelated' },
            {
              type: 'text',
              text: `<${FORK_BOILERPLATE_TAG}>rules</${FORK_BOILERPLATE_TAG}>\n\n${FORK_DIRECTIVE_PREFIX}Review authentication flow`,
            },
          ],
        },
      },
    });

    const renderedText = collectText(node);
    expect(renderedText).toBe('Fork: Review authentication flow');
    expect(renderedText).not.toContain(FORK_BOILERPLATE_TAG);
    expect(renderedText).not.toContain(FORK_DIRECTIVE_PREFIX);
  });

  test('returns null when no fork boilerplate block is present', () => {
    const node = UserForkBoilerplateMessage({
      param: {
        message: {
          content: [{ type: 'text', text: 'regular user message' }],
        },
      },
    });

    expect(node).toBeNull();
  });
});
