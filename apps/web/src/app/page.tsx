'use client';
import React, { useState, useEffect } from 'react';
import { Typography, Card, Input, Button, Space, Row, Col, Alert, Spin } from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api-client/client';
import { CheckCircleOutlined, SettingOutlined, DatabaseOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

export default function DemoDashboard() {
  const [reviewId, setReviewId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recentReviewId, setRecentReviewId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('recentReviewId');
    if (saved) {
      setRecentReviewId(saved);
    }
  }, []);

  const saveRecentReview = (id: string) => {
    localStorage.setItem('recentReviewId', id);
    setRecentReviewId(id);
  };

  const handleRouteClick = (id: string, route: string) => {
    saveRecentReview(id);
    router.push(`/reviews/${id}${route}`);
  };

  const handleCreateMockDemo = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(false);

      // 1. Create Review
      const review = await apiClient.createReview({
        title: 'PrismReview MVP Demo',
        objective: 'Evaluate the proposed architecture for scalability, cost, and delivery risk'
      });
      const newReviewId = review.id;

      // 2. Diagnose
      await apiClient.createDiagnosis(newReviewId);

      // 3. Get Diagnosis for recommended roles
      const diagnosis = await apiClient.getDiagnosis(newReviewId);
      
      if (!diagnosis) {
        throw new Error("未能获取到诊断结果。");
      }

      // 4. Select Roles (top 3)
      const topRoles = diagnosis.recommendedRoles.slice(0, 3).map(r => ({
        roleId: r.roleId,
        weight: r.weight
      }));
      await apiClient.saveRoleSelection(newReviewId, topRoles);

      // 5. Start Review
      await apiClient.startReview(newReviewId);

      setReviewId(newReviewId);
      saveRecentReview(newReviewId);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || '创建 Mock 演示评审失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingTop: 32, paddingBottom: 64 }}>
      {/* Hero Section */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={1} style={{ margin: 0, fontSize: 48, color: '#1890ff' }}>PrismReview</Title>
        <Title level={3} style={{ marginTop: 8, color: '#595959' }}>AI 评审委员会</Title>
        <Paragraph style={{ fontSize: 16, color: '#8c8c8c', maxWidth: 600, margin: '16px auto' }}>
          AI 评审委员会，自动组织多角色专家完成方案评审
        </Paragraph>
      </div>

      {/* Core Steps */}
      <Row gutter={[24, 24]} style={{ marginBottom: 48 }}>
        <Col span={8}>
          <Card title="1. 提交评审材料" bordered={false} style={{ height: '100%', background: '#fafafa' }}>
            上传您的设计文档。AI 将解析上下文，并推荐理想的专家评审团。
          </Card>
        </Col>
        <Col span={8}>
          <Card title="2. AI 委员会评审" bordered={false} style={{ height: '100%', background: '#fafafa' }}>
            观察由专业智能体 (Security, CTO, PMO) 组成的评审团进行实时讨论，识别风险并进行架构推演。
          </Card>
        </Col>
        <Col span={8}>
          <Card title="3. 生成评审报告" bordered={false} style={{ height: '100%', background: '#fafafa' }}>
            自动汇聚风险清单、专家意见和整改行动项，输出结构化的全景评审报告。
          </Card>
        </Col>
      </Row>

      {/* Recent Reviews */}
      {recentReviewId && (
        <Card title="最近评审" style={{ marginBottom: 48, borderColor: '#52c41a' }} extra={<Button type="link" danger onClick={() => { localStorage.removeItem('recentReviewId'); setRecentReviewId(null); }}>清除记录</Button>}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text type="secondary">评审 ID: <Text strong copyable>{recentReviewId}</Text></Text>
            <Space>
              <Button onClick={() => handleRouteClick(recentReviewId, '')}>查看诊断</Button>
              <Button onClick={() => handleRouteClick(recentReviewId, '/meeting')}>进入会议室</Button>
              <Button onClick={() => handleRouteClick(recentReviewId, '/report')}>查看报告</Button>
            </Space>
          </div>
        </Card>
      )}

      {/* My Reviews Entry */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Button type="primary" size="large" onClick={() => router.push('/reviews')} style={{ width: 250, height: 50, fontSize: 18, borderRadius: 8 }}>
          查看我的评审
        </Button>
      </div>

      {/* Demo Tools */}
      <Title level={4} style={{ marginTop: 64, marginBottom: 24, borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>演示工具 (Demo Tools)</Title>
      <Row gutter={[24, 24]}>
        {/* Route 1: Mock Demo */}
        <Col span={12}>
          <Card 
            title={<><SettingOutlined style={{ marginRight: 8 }} /> 快速 Mock 演示</>}
            style={{ height: '100%' }}
          >
            <Paragraph>
              快速生成包含兜底数据的演示评审。无需连接真实的后端 LLM。
            </Paragraph>
            
            {loading ? (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Spin tip="正在创建演示评审..." />
              </div>
            ) : (
              <Button type="primary" size="large" onClick={handleCreateMockDemo} block>
                创建 Mock 演示评审
              </Button>
            )}

            {error && (
              <Alert message="创建演示评审失败" description={<>请求字段与后端契约不一致，请检查提交参数。<br/><br/><Text type="secondary">{error}</Text></>} type="error" showIcon style={{ marginTop: 16 }} action={<Button onClick={handleCreateMockDemo}>重试</Button>} />
            )}

            {success && reviewId && (
              <Card type="inner" style={{ marginTop: 16, borderColor: '#52c41a', background: '#f6ffed' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                  <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24, marginRight: 8 }} />
                  <Text strong style={{ fontSize: 16 }}>评审创建成功</Text>
                </div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>评审 ID: {reviewId}</Text>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button block onClick={() => handleRouteClick(reviewId, '')}>查看诊断</Button>
                  <Button block onClick={() => handleRouteClick(reviewId, '/meeting')}>进入会议室</Button>
                  <Button block onClick={() => handleRouteClick(reviewId, '/report')}>查看报告</Button>
                </Space>
              </Card>
            )}
          </Card>
        </Col>

        {/* Route 2: DB Opinions / Real Agent Demo */}
        <Col span={12}>
          <Card 
            title={<><DatabaseOutlined style={{ marginRight: 8 }} /> DB 评审意见演示</>}
            style={{ height: '100%' }}
          >
            <Paragraph>
              如果要运行由真实智能体参与的完整评审，请先在后端运行 CLI 脚本：
            </Paragraph>
            <div style={{ background: '#000', color: '#fff', padding: '12px', borderRadius: 6, fontFamily: 'monospace', marginBottom: 16 }}>
              node scripts/setup-demo-review.js --with-runner
            </div>
            <Paragraph>
              脚本生成有效的 <Text code>reviewId</Text> 后，请将其粘贴至下方以进入评审。
            </Paragraph>
            
            <Input 
              placeholder="在此粘贴 Review ID..." 
              value={!success ? reviewId : ''} 
              onChange={(e) => {
                setReviewId(e.target.value);
                setSuccess(false);
              }} 
              size="large"
              style={{ marginBottom: 16 }}
            />
            
            <Space style={{ width: '100%' }}>
              <Button 
                disabled={!reviewId || success}
                onClick={() => handleRouteClick(reviewId, '')}
              >
                查看诊断
              </Button>
              <Button 
                disabled={!reviewId || success}
                onClick={() => handleRouteClick(reviewId, '/meeting')}
              >
                进入会议室
              </Button>
              <Button 
                disabled={!reviewId || success}
                onClick={() => handleRouteClick(reviewId, '/report')}
              >
                查看报告
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
