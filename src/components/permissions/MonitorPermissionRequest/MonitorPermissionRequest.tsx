import * as React from 'react';
import { Box, Text } from '@anthropic/ink';

interface MonitorPermissionRequestProps {
  onAllow: () => void;
  onDeny: () => void;
}

export function MonitorPermissionRequest(_props: MonitorPermissionRequestProps): React.ReactElement {
  return (
    <Box>
      <Text>Monitor permission request</Text>
    </Box>
  );
}
