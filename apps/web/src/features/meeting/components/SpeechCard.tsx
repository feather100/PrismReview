import React, { useState } from 'react';
import { Card, Tag, Typography, Button } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { getRoleDisplayName } from '../../../lib/i18n/role-mapper';

const { Text, Paragraph } = Typography;

export interface SpeechCardData {
  id: string;
  turnId: string;
  agentCode?: string;
  agentName: string;
  dimension: string;
  riskLevel: 'high' | 'medium' | 'low' | 'info' | 'pending';
  content: string;
  timestamp: string;
}

interface Props {
  data: SpeechCardData;
}

export default function SpeechCard({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  
  let color = 'default';
  if (data.riskLevel === 'high') color = 'error';
  else if (data.riskLevel === 'medium') color = 'warning';
  else if (data.riskLevel === 'low') color = 'success';
  else if (data.riskLevel === 'info') color = 'processing';

  const fullContent = data.content;
  // G12 Degradation: Auto fold by char count > 150
  const isLong = fullContent.length > 150;
  const displayContent = !expanded && isLong ? fullContent.slice(0, 150) + '...' : fullContent;

  return (
    <Card 
      size="small" 
      style={{ marginBottom: 16, borderLeft: `4px solid var(--ant-${color})` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong>{getRoleDisplayName(data.agentCode || '', data.agentName)}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{data.timestamp}</Text>
      </div>
      
      <div style={{ marginBottom: 8 }}>
        <Tag>{data.dimension}</Tag>
        <Tag color={color}>{data.riskLevel.toUpperCase()}</Tag>
      </div>
      
      <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
        {displayContent}
      </Paragraph>
      
      {isLong && (
        <Button 
          type="link" 
          size="small" 
          style={{ padding: 0, marginTop: 8 }} 
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <><UpOutlined /> 收起</> : <><DownOutlined /> 展开阅读</>}
        </Button>
      )}
    </Card>
  );
}
