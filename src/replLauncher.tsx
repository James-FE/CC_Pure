import React from 'react';
import type { StatsStore } from './context/stats.js';
import type { Root } from '@anthropic/ink';
import type { Props as REPLProps } from './screens/REPL.js';
import type { AppState } from './state/AppStateStore.js';
import type { FpsMetrics } from './utils/fpsTracker.js';
import { feature } from 'bun:bundle';

type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
};

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  // Pipe IPC — lazy-loaded so the import chain (net, dgram, crypto, etc.)
  // doesn't block cold start in bundled builds. See UDS_INBOX note in
  // scripts/defines.ts.
  if (feature('UDS_INBOX')) {
    const { ensurePipeIpc } = await import('./utils/pipeBootstrap.js');
    void ensurePipeIpc();
  }
  const { App } = await import('./components/App.js');
  const { SentryErrorBoundary } = await import('./components/SentryErrorBoundary.js');
  const { REPL } = await import('./screens/REPL.js');
  await renderAndRun(
    root,
    <SentryErrorBoundary name="RootREPLBoundary">
      <App {...appProps}>
        <REPL {...replProps} />
      </App>
    </SentryErrorBoundary>,
  );
}
