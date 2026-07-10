'use client';
import React, { useEffect, useState } from 'react';
import { Card, Tag, Typography, Spin, Space, Button, Row, Col, List, Alert, Empty, Tooltip, message, Steps } from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient, DiagnosisResponse, RecommendedRole, RadarDimension, RoleSelectionInput, ReviewResponse } from '../../lib/api-client/client';
import { getRoleDisplayName } from '../../lib/i18n/role-mapper';

const { Title, Paragraph } = Typography;

const isReviewStateError = (err: any): boolean => {
  const msg = err?.message || '';
  return /status|状态|allow|VALIDATION_ERROR/i.test(msg);
};

export default function DiagnosisPage({ reviewId }: { reviewId: string }) {
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const [diagnosing, setDiagnosing] = useState(false);

  const fetchDiagnosisData = async () => {
    setLoading(true);
    setError(null);
    try {
      const revRes = await apiClient.getReview(reviewId);
      setReview(revRes);

      const diagRes = await apiClient.getDiagnosis(reviewId);
      setData(diagRes);
    } catch (err: any) {
      setError(err.message || "获取数据失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnosisData();
  }, [reviewId]);

  const handleDiagnose = async () => {
    setDiagnosing(true);
    try {
      await apiClient.createDiagnosis(reviewId);
      message.success('诊断已完成');
      await fetchDiagnosisData();
    } catch (err: any) {
      if (isReviewStateError(err)) {
         message.error('当前状态不允许重新诊断，请刷新页面查看最新状态。');
      } else {
         message.error(err.message || '请求诊断失败。');
      }
    } finally {
      setDiagnosing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="加载诊断结果...">
          <div style={{ padding: 50 }} />
        </Spin>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          message="诊断失败"
          description={error}
          type="error"
          showIcon
          action={<Button onClick={() => window.location.reload()}>重试</Button>}
        />
      </div>
    );
  }

  let currentStep = 0;
  let stepsStatus: 'process' | 'error' | 'finish' | 'wait' = 'process';
  let nextActionText = '';
  
  if (review?.status === 'draft') {
    currentStep = 1;
    nextActionText = '下一步：开始诊断';
  } else if (review?.status === 'diagnosing') {
    currentStep = 1;
    nextActionText = '诊断中，请稍候';
  } else if (review?.status === 'ready') {
    currentStep = 2;
    nextActionText = '下一步：确认评审团';
  } else if (review?.status === 'running' || review?.status === 'interrupted' || review?.status === 'summarizing') {
    currentStep = 3;
    nextActionText = '下一步：等待会议完成';
  } else if (review?.status === 'completed') {
    currentStep = 4;
    stepsStatus = 'finish';
    nextActionText = '下一步：查看评审报告';
  } else if (review?.status === 'archived') {
    currentStep = 4;
    stepsStatus = 'finish';
    nextActionText = '该评审已归档，仅可查看历史记录';
  } else if (review?.status === 'failed') {
    stepsStatus = 'error';
    currentStep = data ? 3 : 1;
    nextActionText = '评审失败，请查看错误信息';
  }

  const timelineModule = review ? (
    <Card style={{ marginBottom: 24 }} styles={{ body: { padding: '16px 24px' } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Text strong style={{ fontSize: 16 }}>评审进度</Typography.Text>
        <Typography.Text type={stepsStatus === 'error' ? 'danger' : 'secondary'}>{nextActionText}</Typography.Text>
      </div>
      <Steps
        current={currentStep}
        status={stepsStatus}
        size="small"
        items={[
          { title: '创建评审' },
          { title: '开始诊断' },
          { title: '确认评审团' },
          { title: '进入评审会议' },
          { title: '生成评审报告' },
        ]}
      />
    </Card>
  ) : null;

  const handleConfirm = async () => {
    if (review?.status !== 'ready') {
      message.warning('当前状态不可确认评审团，请刷新后重试。');
      return;
    }
    if (!data || data.recommendedRoles.length === 0) return;
    
    setSubmitting(true);
    try {
      // 1. Map to RoleSelectionInput
      const payload: RoleSelectionInput[] = data.recommendedRoles.map(r => ({
        roleId: r.roleId,
        weight: r.weight
      }));

      // 2. Save roles
      await apiClient.saveRoleSelection(reviewId, payload);
      
      // 3. Start review
      await apiClient.startReview(reviewId);
      
      message.success('评审团确认成功，评审已启动！');
      
      // 4. Redirect
      router.push(`/reviews/${reviewId}/meeting`);
    } catch (err: any) {
      if (isReviewStateError(err)) {
        message.error('该评审已开始，请进入会议室继续查看。');
      } else {
        message.error(err.message || '确认评审团或启动评审失败。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isConfirmEnabled = data && data.recommendedRoles.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>评审诊断</Title>
        <Space>
          <Tooltip title="当前为只读模式，权限/动作接口尚未接入">
            <Button disabled>取消</Button>
          </Tooltip>
          {review?.status === 'draft' && (
            <Button 
              type="primary" 
              loading={diagnosing}
              onClick={handleDiagnose}
            >
              {diagnosing ? '诊断中...' : '开始诊断'}
            </Button>
          )}
          {review?.status === 'ready' && (
            <Button 
              type="primary" 
              disabled={!isConfirmEnabled} 
              loading={submitting}
              onClick={handleConfirm}
            >
              确认评审团
            </Button>
          )}
          {(review?.status === 'running' || review?.status === 'interrupted' || review?.status === 'summarizing') && (
            <Button 
              type="primary" 
              onClick={() => router.push(`/reviews/${reviewId}/meeting`)}
            >
              进入会议室
            </Button>
          )}
          {review?.status === 'completed' && (
            <Button 
              type="primary" 
              onClick={() => router.push(`/reviews/${reviewId}/report`)}
            >
              查看评审报告
            </Button>
          )}
          {review?.status === 'failed' && (
            <Button type="primary" disabled>
              评审失败
            </Button>
          )}
        </Space>
      </div>

      {timelineModule}

      {!data ? (
        review?.status === 'draft' ? (
          <div style={{ padding: '64px 48px', background: '#fff', borderRadius: 8, textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 16, color: '#262626' }}>
              评审材料已提交，开始您的 AI 架构评审之旅
            </Title>
            <div style={{ marginBottom: 32, color: '#8c8c8c' }}>点击下方按钮，系统将为您生成风险摘要并推荐专家评审团。</div>
            <Button 
              type="primary" 
              size="large" 
              loading={diagnosing} 
              onClick={handleDiagnose}
              style={{ width: 200, height: 48, fontSize: 16 }}
            >
              {diagnosing ? '系统诊断中...' : '开始诊断'}
            </Button>
          </div>
        ) : (
          <div style={{ padding: 48, background: '#fff', borderRadius: 8 }}>
            <Empty description="未找到该评审的诊断结果。" />
          </div>
        )
      ) : (
        <Row gutter={[24, 24]}>
        <Col span={16}>
          <Card title="架构摘要" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <Space size={[0, 8]} wrap>
                {data.tags.map((tag: string) => (
                  <Tag color="blue" key={tag}>{tag}</Tag>
                ))}
              </Space>
              <div style={{ fontWeight: 'bold' }}>
                置信度: <Tag color={data.confidenceScore > 80 ? 'success' : 'warning'}>{data.confidenceScore}%</Tag>
              </div>
            </div>
            <Paragraph>{data.summary}</Paragraph>
          </Card>
          <Card title="风险雷达 (原始数据)">
            {/* G01 degradation: Render as raw list instead of a chart if unstructured or just raw text */}
            <List
              size="small"
              bordered
              dataSource={data.radarDimensions}
              renderItem={(d: RadarDimension) => <List.Item>{d.name}: <strong>{d.score} / 100</strong></List.Item>}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="推荐评审团">
            {data.recommendedRoles.map((role: RecommendedRole) => {
              return (
                <Card type="inner" key={role.roleId} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ marginRight: 8 }}>{getRoleDisplayName(role.roleCode, role.roleName)}</strong>
                      <Tag>{role.roleCode}</Tag>
                    </div>
                    <Tag color="default">
                      {role.weight}%
                    </Tag>
                  </div>
                  {role.reason && (
                    <div style={{ fontSize: 13, color: '#555', marginTop: 12 }}>
                      <strong>推荐理由:</strong> {role.reason}
                    </div>
                  )}
                </Card>
              );
            })}
            <Tooltip title="当前为只读模式，权限/动作接口尚未接入">
              <div style={{ width: '100%' }}>
                <Button type="dashed" block disabled>+ 添加角色</Button>
              </div>
            </Tooltip>
          </Card>
        </Col>
      </Row>
      )}
    </div>
  );
}
