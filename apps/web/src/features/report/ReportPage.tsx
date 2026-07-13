'use client';
import React, { useEffect, useState } from 'react';
import { Space, Typography, Tag, Button, Card, Row, Col, Table, List, Spin, Alert, Empty, Divider, message } from 'antd';
import { useRouter } from 'next/navigation';
import { DownloadOutlined } from '@ant-design/icons';
import { apiClient, ReportResponse } from '../../lib/api-client/client';
import { getRoleDisplayName } from '../../lib/i18n/role-mapper';

const { Title, Paragraph, Text } = Typography;

const GradeTag = ({ grade }: { grade: string }) => {
  const map: Record<string, { color: string, text: string }> = {
    'approved': { color: 'success', text: '通过' },
    'conditionally_approved': { color: 'warning', text: '有条件通过' },
    'rejected': { color: 'error', text: '拒绝' },
  };
  const config = map[grade] || { color: 'default', text: grade };
  return <Tag color={config.color} style={{ fontSize: 16, padding: '4px 12px' }}>{config.text}</Tag>;
};

const RiskTag = ({ level }: { level: string }) => {
  const colorMap: Record<string, string> = { high: 'red', medium: 'orange', low: 'blue', info: 'default' };
  return <Tag color={colorMap[level] || 'default'}>{level.toUpperCase()}</Tag>;
};

export default function ReportPage({ reviewId }: { reviewId: string }) {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingMd, setDownloadingMd] = useState(false);

  const router = useRouter();

  const handleExportMarkdown = async () => {
    setDownloadingMd(true);
    try {
      await apiClient.exportReportMarkdown(reviewId);
    } catch (err: any) {
      message.error(err.message || '导出 Markdown 失败，请稍后重试。');
    } finally {
      setDownloadingMd(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    // First fetch review status to avoid ugly backend errors
    apiClient.getReview(reviewId)
      .then((review) => {
        if (review.status === 'created' || review.status === 'diagnosed' || review.status === 'running') {
          setError(`该评审尚未完成（当前状态：${review.status}），暂无报告。`);
          setLoading(false);
          return;
        }
        
        return apiClient.getReport(reviewId).then((res) => {
          setData(res);
          setLoading(false);
        });
      })
      .catch((err) => {
        setError(err.message || "获取数据失败。");
        setLoading(false);
      });
  }, [reviewId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="加载评审报告...">
          <div style={{ padding: 50 }} />
        </Spin>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          message="访问提示"
          description={error}
          type="warning"
          showIcon
          action={
            <Space>
              <Button onClick={() => router.push(`/reviews`)}>返回列表</Button>
              <Button type="primary" onClick={() => router.push(`/reviews/${reviewId}`)}>查看诊断</Button>
            </Space>
          }
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 48, background: '#fff', borderRadius: 8 }}>
        <Empty description="未找到报告。评审可能尚未完成。" />
      </div>
    );
  }

  const actionColumns = [
    { title: '优先级', dataIndex: 'priority', key: 'priority', render: (text: string) => <Tag color={text === 'p0' ? 'red' : text === 'p1' ? 'orange' : 'blue'}>{text?.toUpperCase() || text}</Tag> },
    { title: '行动项', dataIndex: 'title', key: 'title', width: '40%' },
    { title: '来源', dataIndex: 'sourceAgent', key: 'sourceAgent', render: (text: string) => getRoleDisplayName(text) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (text: string) => <Tag>{text}</Tag> },
  ];

  const opinionColumns = [
    { title: '维度', dataIndex: 'dimension', key: 'dimension' },
    { title: '智能体', dataIndex: 'agentName', key: 'agentName', render: (text: string, record: any) => getRoleDisplayName(record.agentCode, text) },
    { title: '风险', dataIndex: 'riskLevel', key: 'riskLevel', render: (text: string) => <RiskTag level={text} /> },
    { title: '问题', dataIndex: 'issue', key: 'issue', width: '25%' },
    { title: '建议', dataIndex: 'recommendation', key: 'recommendation', width: '30%' },
    { title: '置信度', dataIndex: 'confidenceScore', key: 'confidenceScore', render: (num: number) => `${num}%` },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 64 }}>
      {/* 1. Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <Space direction="vertical" size={2}>
          <Space align="center">
            <Title level={2} style={{ margin: 0 }}>{data.title || `评审报告`}</Title>
            {data.source === 'mock_fallback' ? (
              <Tag color="orange" style={{ marginLeft: 8 }}>Mock 兜底数据</Tag>
            ) : data.source === 'db_opinions' || data.generatedFromTurns === true ? (
              <Tag color="cyan" style={{ marginLeft: 8 }}>来自真实 Agent 评审意见</Tag>
            ) : null}
            {data.opinionCount !== undefined && (
              <Text type="secondary" style={{ marginLeft: 8 }}>{data.opinionCount} opinions</Text>
            )}
          </Space>
          <Text type="secondary">评审 ID: {reviewId}</Text>
          
          {data.providerSummary && (
            <div style={{ marginTop: 12, padding: '8px 16px', background: '#f5f5f5', borderRadius: 6, fontSize: 13 }}>
              <Space split={<Divider type="vertical" />} wrap>
                <Text strong>生成来源摘要</Text>
                <Text type="secondary">总发言数: {data.providerSummary.totalTurns}</Text>
                <Text type="secondary">
                  分布: Mock({data.providerSummary.bySource.mock || 0}) / 
                  LMStudio({data.providerSummary.bySource.lmstudio || 0}) / 
                  OpenAI({data.providerSummary.bySource.openai_compatible || 0}) / 
                  Fallback({data.providerSummary.bySource.fallback_mock || 0}) / 
                  Failed({data.providerSummary.bySource.failed || 0})
                </Text>
                <Text type="secondary">
                  模型: {data.providerSummary.models.length > 0 ? data.providerSummary.models.join(', ') : '未记录模型'}
                </Text>
                <Space>
                  {data.providerSummary.hasRealProvider && <Tag color="blue" style={{ margin: 0 }}>真实模型参与</Tag>}
                  {data.providerSummary.fallbackCount > 0 && <Tag color="orange" style={{ margin: 0 }}>已发生 Fallback</Tag>}
                  {data.providerSummary.failedCount > 0 && <Tag color="red" style={{ margin: 0 }}>存在失败 Turn</Tag>}
                </Space>
              </Space>
            </div>
          )}
        </Space>
        <Space>
          <GradeTag grade={data.verdict} />
          <Button disabled icon={<DownloadOutlined />}>导出 PDF</Button>
          <Button 
            icon={<DownloadOutlined />}
            onClick={handleExportMarkdown}
            loading={downloadingMd}
          >
            导出 Markdown
          </Button>
        </Space>
      </div>

      {/* 2. Executive Summary */}
      <Card title="1. 执行摘要" style={{ marginBottom: 24 }}>
        <Paragraph style={{ fontSize: 16 }}>{data.executiveSummary}</Paragraph>
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col span={6}>
            <div style={{ textAlign: 'center', padding: '16px 0', background: '#fafafa', borderRadius: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4f' }}>{data.metrics?.p0RiskCount || 0}</div>
              <div style={{ color: '#666' }}>P0 风险数</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center', padding: '16px 0', background: '#fafafa', borderRadius: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 'bold' }}>{data.metrics?.totalRiskCount || 0}</div>
              <div style={{ color: '#666' }}>总风险数</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center', padding: '16px 0', background: '#fafafa', borderRadius: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: '#52c41a' }}>{data.metrics?.adoptionRate || 0}%</div>
              <div style={{ color: '#666' }}>采纳率</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center', padding: '16px 0', background: '#fafafa', borderRadius: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 'bold' }}>{data.metrics?.durationMinutes || 0} 分钟</div>
              <div style={{ color: '#666' }}>评审耗时</div>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 3. Action Items */}
      <Card title="2. 整改行动项" style={{ marginBottom: 24 }}>
        <Table 
          columns={actionColumns} 
          dataSource={data.actionItems} 
          rowKey={(record) => `${record.title}-${record.sourceAgent}`} 
          pagination={false}
          size="middle"
        />
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" disabled>同步至 Jira (未连接)</Button>
        </div>
      </Card>

      {/* 4. Identified Risks */}
      <Card title="3. 识别风险" style={{ marginBottom: 24 }}>
        <List
          grid={{ gutter: 16, column: 2 }}
          dataSource={data.risks}
          rowKey={(item) => `${item.title}-${item.sourceAgent}`}
          renderItem={(risk) => (
            <List.Item>
              <Card type="inner" title={risk.title} extra={<RiskTag level={risk.riskLevel} />}>
                <div style={{ marginBottom: 8 }}><Text type="secondary">来源: {getRoleDisplayName(risk.sourceAgent)}</Text></div>
                <div>{risk.description}</div>
              </Card>
            </List.Item>
          )}
        />
      </Card>

      {/* 5. Expert Opinions */}
      <Card title="4. 专家意见" style={{ marginBottom: 24 }}>
        <Table 
          columns={opinionColumns} 
          dataSource={data.opinions} 
          rowKey={(record) => `${record.dimension}-${record.agentCode}`} 
          pagination={false}
          size="small"
        />
      </Card>
      
      {/* 6. Low Confidence Items */}
      {data.lowConfidenceItems && data.lowConfidenceItems.length > 0 && (
        <Card title="5. 低置信度意见 (需要人工复核)" style={{ marginBottom: 24, borderColor: '#faad14' }}>
          <List
            size="small"
            dataSource={data.lowConfidenceItems}
            rowKey={(item) => `${item.agentCode}-${item.issue}`}
            renderItem={(item) => (
              <List.Item>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong>{getRoleDisplayName(item.agentCode, item.agentName)} ({item.agentCode})</Text>
                    <Tag color="warning">置信度: {item.confidenceScore}%</Tag>
                  </div>
                  <Text type="secondary">{item.issue}</Text>
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
}
