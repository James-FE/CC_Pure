import { describe, expect, test } from 'bun:test';
import { collectFromEvents, groupByPhase, PhaseProgress } from '../PhaseProgress.js';
import type { SdkWorkflowProgress } from 'src/types/tools.js';

describe('PhaseProgress', () => {
  test('returns null without workflow progress items', () => {
    expect(PhaseProgress({})).toBeNull();
    expect(PhaseProgress({ workflowProgress: [] })).toBeNull();
  });

  test('upserts progress items by type and index with later items winning', () => {
    const events: SdkWorkflowProgress[] = [
      {
        type: 'phase',
        index: 0,
        phaseIndex: 0,
        label: 'Plan',
        status: 'pending',
      },
      {
        type: 'phase',
        index: 0,
        phaseIndex: 0,
        label: 'Plan',
        status: 'completed',
        detail: 'ready',
      },
      {
        type: 'agent',
        index: 1,
        phaseIndex: 0,
        label: 'Implement',
        status: 'in_progress',
      },
    ];

    expect(collectFromEvents(events)).toEqual([
      {
        type: 'phase',
        index: 0,
        phaseIndex: 0,
        label: 'Plan',
        status: 'completed',
        detail: 'ready',
      },
      {
        type: 'agent',
        index: 1,
        phaseIndex: 0,
        label: 'Implement',
        status: 'in_progress',
      },
    ]);
  });

  test('groups collected items by phaseIndex in phase order', () => {
    const collected: SdkWorkflowProgress[] = [
      {
        type: 'agent',
        index: 2,
        phaseIndex: 1,
        label: 'Verify',
        status: 'pending',
      },
      {
        type: 'phase',
        index: 0,
        phaseIndex: 0,
        label: 'Plan',
        status: 'completed',
      },
    ];

    expect(groupByPhase(collected)).toEqual([
      {
        phaseIndex: 0,
        items: [
          {
            type: 'phase',
            index: 0,
            phaseIndex: 0,
            label: 'Plan',
            status: 'completed',
          },
        ],
      },
      {
        phaseIndex: 1,
        items: [
          {
            type: 'agent',
            index: 2,
            phaseIndex: 1,
            label: 'Verify',
            status: 'pending',
          },
        ],
      },
    ]);
  });
});
