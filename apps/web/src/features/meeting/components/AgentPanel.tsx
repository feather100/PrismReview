import React from 'react';
import { Card, List, Typography } from 'antd';
import AgentStatusDot, { AgentTurnStatus } from './AgentStatusDot';
import { getRoleDisplayName } from '../../../lib/i18n/role-mapper';

const { Text } = Typography;

export interface AgentStatus {
  roleId: string;
  roleCode: string;
  roleName: string;
  status: AgentTurnStatus;
  speechCount: number;
}

interface Props {
  agents: AgentStatus[];
}

export default function AgentPanel({ agents }: Props) {
  return (
    <Card title="AI 评审委员会" style={{ height: '100%' }} bodyStyle={{ padding: 0 }}>
      <List
        dataSource={agents}
        renderItem={(agent) => (
          <List.Item style={{ padding: '16px 24px' }}>
            <List.Item.Meta
              title={getRoleDisplayName(agent.roleCode, agent.roleName)}
              description={<Text type="secondary">{agent.roleCode}</Text>}
            />
            <div style={{ textAlign: 'right' }}>
              <AgentStatusDot status={agent.status} animate />
              <div style={{ fontSize: 12, marginTop: 4, color: '#888' }}>
                发言数: {agent.speechCount}
              </div>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
