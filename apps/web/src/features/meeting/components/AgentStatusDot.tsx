import React from 'react';
import { Badge } from 'antd';

export type AgentTurnStatus = 'waiting' | 'speaking' | 'done' | 'failed';

interface Props {
  status: AgentTurnStatus;
  animate?: boolean;
}

export default function AgentStatusDot({ status, animate }: Props) {
  let color = 'default';
  let text = '等待中';
  
  if (status === 'speaking') { color = 'processing'; text = '发言中'; }
  else if (status === 'done') { color = 'success'; text = '已发言'; }
  else if (status === 'failed') { color = 'error'; text = '异常'; }

  return (
    <Badge 
      status={color as any} 
      text={text} 
      className={animate && status === 'speaking' ? 'animate-pulse' : ''} 
    />
  );
}
