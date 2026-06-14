import { useMasterMonitor } from '../hooks/useMasterMonitor.js';
import { useSlaveNotifications } from '../hooks/useSlaveNotifications.js';
import { usePipeIpc } from '../hooks/usePipeIpc.js';
import { usePipePermissionForward } from '../hooks/usePipePermissionForward.js';
import { usePipeMuteSync } from '../hooks/usePipeMuteSync.js';
import { usePipeRouter } from '../hooks/usePipeRouter.js';

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

export default function PipeSubsystem({
  store,
  handleIncomingPrompt,
  tools,
  setMessages,
  setToolUseConfirmQueue,
  getToolUseContext,
  mainLoopModel,
  setAppState,
  addNotification,
}: PipeSubsystemProps): null {
  useMasterMonitor();
  useSlaveNotifications();
  usePipePermissionForward({ store, tools, setMessages, setToolUseConfirmQueue, getToolUseContext, mainLoopModel });
  usePipeMuteSync({ setToolUseConfirmQueue });
  usePipeIpc({ store, handleIncomingPrompt });
  usePipeRouter({ store, setAppState, addNotification });

  return null;
}
