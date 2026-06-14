import { useEffect, useState } from 'react';
import type React from 'react';

export interface PipeSubsystemProps {
  store: any;
  handleIncomingPrompt: (content: string) => boolean;
  tools: any;
  setMessages: any;
  setToolUseConfirmQueue: any;
  getToolUseContext: any;
  mainLoopModel: any;
  setAppState: any;
  addNotification: any;
}

export default function PipeSubsystem(props: PipeSubsystemProps): React.ReactNode {
  const [PipeSubsystemImpl, setPipeSubsystemImpl] = useState<React.ComponentType<PipeSubsystemProps> | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void import('./PipeSubsystemImpl.js').then(m => {
        if (alive) setPipeSubsystemImpl(() => m.default);
      });
    }, 0);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return PipeSubsystemImpl ? <PipeSubsystemImpl {...props} /> : null;
}
