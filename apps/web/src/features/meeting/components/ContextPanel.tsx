import React from 'react';
import { Card, Typography, Button, Divider } from 'antd';
import { EditOutlined } from '@ant-design/icons';

const { Paragraph, Text } = Typography;

interface Props {
  summary: string;
}

export default function ContextPanel({ summary }: Props) {
  return (
    <Card title="评审上下文" style={{ height: '100%' }} bodyStyle={{ padding: 16 }}>
      <Text strong>架构摘要</Text>
      <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 13 }}>
        {summary}
      </Paragraph>
      
      <Divider />
      
      <Text strong>人工干预</Text>
      {/* G09 Degradation: No intervention history displayed for now */}
      <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 13, fontStyle: 'italic' }}>
        暂无人工干预记录。
      </Paragraph>

      <div style={{ marginTop: 24 }}>
        <Button block disabled type="dashed" icon={<EditOutlined />}>
          注入条件
        </Button>
      </div>
    </Card>
  );
}
