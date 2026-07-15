'use client';
import React, { useEffect, useState } from 'react';
import { Typography, Card, Row, Col, Tag, Button, Space, Alert, Empty, Spin } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { apiClient, WorkflowPreset } from '../../lib/api-client/client';

const { Title, Text, Paragraph } = Typography;

const WORKFLOW_TAGS: Record<string, string[]> = {
  enterprise: ['企业架构', '多维度', '轮次 3'],
  code_review: ['代码审查', '安全优先', '轮次 2'],
  research: ['科研', '写作质量', '轮次 2'],
  paper: ['论文评审', '同行评议', '轮次 4'],
};

export default function WorkflowsPage() {
  const [wfs, setWfs] = useState<WorkflowPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      setWfs(await apiClient.listWorkflows());
    } catch (e: any) {
      setError(e.message ?? '加载 Workflow 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>Workflow 预设 <ExperimentOutlined /></Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          一键应用不同的评审流程与评分策略。每种 preset 自定义轮次深度、评分维度和收敛阈值。
        </Paragraph>
      </div>

      <Card><Space direction="vertical"><Text type="secondary">可用预设数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : wfs.length}</Text></Space></Card>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={fetch}>重试</Button>} />}

      <Spin spinning={loading}>
        {wfs.length === 0 && !loading ? (
          <Empty description="暂无 Workflow 预设" style={{ padding: 48 }} />
        ) : (
          <Row gutter={[16, 16]}>
            {wfs.map((w) => (
              <Col xs={24} md={12} key={w.id}>
                <Card hoverable>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text strong style={{ fontSize: 16 }}>{w.name}</Text>
                    <Paragraph type="secondary" style={{ marginBottom: 0, minHeight: 40 }}>{w.description}</Paragraph>
                    <Space size={[4, 8]} wrap>
                      {(WORKFLOW_TAGS[w.id] ?? [w.id]).map((t) => <Tag key={t}>{t}</Tag>)}
                    </Space>
                    <div><Button type="link" size="small" style={{ padding: 0 }} onClick={() => void 0}>查看详情</Button></div>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>
    </Space>
  );
}
