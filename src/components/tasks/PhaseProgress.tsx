import type { ReactNode } from 'react';
import { Box, Text } from '@anthropic/ink';
import type { Theme } from '@anthropic/ink';
import type { SdkWorkflowProgress } from 'src/types/tools.js';

type PhaseProgressProps = {
  workflowProgress?: SdkWorkflowProgress[];
};

type PhaseGroup = {
  phaseIndex: number;
  items: SdkWorkflowProgress[];
};

type WorkflowStatus = NonNullable<SdkWorkflowProgress['status']>;

const STATUS_ICON: Record<WorkflowStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  failed: '✕',
};

function statusIcon(status: SdkWorkflowProgress['status']): string {
  return STATUS_ICON[status ?? 'pending'];
}

function statusColor(status: SdkWorkflowProgress['status']): keyof Theme | undefined {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'in_progress':
      return 'warning';
    case 'pending':
    case undefined:
      return undefined;
  }
}

function displayLabel(item: SdkWorkflowProgress): string {
  return item.label ?? `${item.type} ${item.index}`;
}

export function collectFromEvents(workflowProgress: readonly SdkWorkflowProgress[]): SdkWorkflowProgress[] {
  const byKey = new Map<string, SdkWorkflowProgress>();

  for (const item of workflowProgress) {
    byKey.set(`${item.type}:${item.index}`, item);
  }

  return Array.from(byKey.values());
}

export function groupByPhase(items: readonly SdkWorkflowProgress[]): PhaseGroup[] {
  const byPhase = new Map<number, SdkWorkflowProgress[]>();

  for (const item of items) {
    const phaseItems = byPhase.get(item.phaseIndex);
    if (phaseItems) {
      phaseItems.push(item);
    } else {
      byPhase.set(item.phaseIndex, [item]);
    }
  }

  return Array.from(byPhase.entries())
    .sort(([a], [b]) => a - b)
    .map(([phaseIndex, phaseItems]) => ({
      phaseIndex,
      items: phaseItems,
    }));
}

function PhaseProgressRow({ item }: { item: SdkWorkflowProgress }): ReactNode {
  return (
    <Text>
      <Text color={statusColor(item.status)}>{statusIcon(item.status)}</Text> {displayLabel(item)}
      {item.detail && <Text dimColor> · {item.detail}</Text>}
    </Text>
  );
}

export function PhaseProgress({ workflowProgress }: PhaseProgressProps): ReactNode {
  if (!workflowProgress || workflowProgress.length === 0) {
    return null;
  }

  const phases = groupByPhase(collectFromEvents(workflowProgress));
  if (phases.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {phases.map(phase => (
        <Box key={phase.phaseIndex} flexDirection="column" marginLeft={phase.phaseIndex * 2}>
          {phase.items.map(item => (
            <PhaseProgressRow key={`${item.type}:${item.index}`} item={item} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
