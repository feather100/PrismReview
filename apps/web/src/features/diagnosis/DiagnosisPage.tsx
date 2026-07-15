'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Tag, Typography, Spin, Space, Button, Row, Col, List, Alert, Empty, message, Steps, Slider, Switch, Tooltip, InputNumber, Avatar,
} from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient, DiagnosisResponse, RecommendedRole, RadarDimension, RoleSelectionInput, ReviewResponse, RoleBrief } from '../../lib/api-client/client';
import { getRoleDisplayName } from '../../lib/i18n/role-mapper';
import RadarChart from '../../components/charts/RadarChart';

const { Title, Paragraph } = Typography;

const isReviewStateError = (err: any): boolean => {
  const msg = err?.message || '';
  return /status|状态|allow|VALIDATION_ERROR/i.test(msg);
};

interface SelectedRole {
  roleId: string;
  roleCode: string;
  roleName: string;
  weight: number;
  enabled: boolean;
  removable: boolean;
  reason?: string;
}

const ROLE_COLORS: Record<string, string> = {
  CTO: '#0ea5e9', CFO: '#22c55e', PMO: '#a855f7', Compliance: '#ef4444', UserAdvocate: '#f59e0b',
};
const hashColor = (code: string) => ROLE_COLORS[code] ?? '#6366f1';

export default function DiagnosisPage({ reviewId }: { reviewId: string }) {
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const [diagnosing, setDiagnosing] = useState(false);

  // 评审团编辑状态
  const [allRoles, setAllRoles] = useState<RoleBrief[]>([]);
  const [selected, setSelected] = useState<SelectedRole[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchDiagnosisData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const revRes = await apiClient.getReview(reviewId);
      setReview(revRes);
      const diagRes = await apiClient.getDiagnosis(reviewId);
      setData(diagRes);
    } catch (err: any) {
      setError(err.message || '获取数据失败。');
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => { fetchDiagnosisData(); }, [fetchDiagnosisData]);

  // 拉取全部可用角色，与推荐列表合并成可编辑的 selected 状态
  useEffect(() => {
    if (review?.status !== 'diagnosed' || !data) return;
    let cancelled = false;
    (async () => {
      try {
        const roles = await module_import_listRoles();
        if (cancelled) return;
        setAllRoles(roles);
        // 合并：推荐列表优先（保留 reason / weight），不在推荐里的角色作为"可选"
        const recMap = new Map(data.recommendedRoles.map((r) => [r.roleId, r]));
        const merged: SelectedRole[] = [];
        // 先放推荐（按推荐顺序）
        for (const r of data.recommendedRoles) {
          merged.push({
            roleId: r.roleId,
            roleCode: r.roleCode,
            roleName: r.roleName,
            weight: r.weight,
            enabled: true,
            removable: r.removable,
            reason: r.reason,
          });
        }
        // 再放未推荐的可用角色（disabled）
        for (const role of roles) {
          if (recMap.has(role.id)) continue;
          merged.push({
            roleId: role.id,
            roleCode: role.code,
            roleName: role.name,
            weight: 50,
            enabled: false,
            removable: true,
          });
        }
        setSelected(merged);
      } catch { /* ignore role list failure */ }
    })();
    return () => { cancelled = true; };
  }, [review?.status, data]);

  // 动态 import 避免循环依赖
  async function module_import_listRoles() {
    const m = await import('../../lib/api-client/client');
    return m.moduleClient.listRoles();
  }

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

  const handleSaveAndStart = async () => {
    if (review?.status !== 'diagnosed') {
      message.warning('当前状态不可确认评审团，请刷新后重试。');
      return;
    }
    const enabled = selected.filter((r) => r.enabled);
    if (enabled.length === 0) {
      message.warning('请至少选择一位评审员');
      return;
    }
    setSaving(true);
    setSubmitting(true);
    try {
      const payload: RoleSelectionInput[] = enabled.map((r) => ({ roleId: r.roleId, weight: r.weight }));
      await apiClient.saveRoleSelection(reviewId, payload);
      await apiClient.startReview(reviewId);
      message.success('评审团已保存，评审已启动！');
      router.push(`/reviews/${reviewId}/meeting`);
    } catch (err: any) {
      if (isReviewStateError(err)) {
        message.error('该评审已开始，请进入会议室继续查看。');
      } else {
        message.error(err.message || '保存评审团或启动评审失败。');
      }
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" tip="加载诊断结果..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert message="诊断失败" description={error} type="error" showIcon action={<Button onClick={() => window.location.reload()}>重试</Button>} />
      </div>
    );
  }

  let currentStep = 0;
  let stepsStatus: 'process' | 'error' | 'finish' | 'wait' = 'process';
  let nextActionText = '';
  if (review?.status === 'created') {
    currentStep = 1; nextActionText = data ? '诊断中，请稍候' : '下一步：开始诊断';
  } else if (review?.status === 'diagnosed') {
    currentStep = 2; nextActionText = '下一步：确认评审团';
  } else if (review?.status === 'running' || review?.status === 'interrupted' || review?.status === 'summarized') {
    currentStep = 3; nextActionText = '评审进行中';
  } else if (review?.status === 'completed') {
    currentStep = 4; stepsStatus = 'finish'; nextActionText = '查看评审报告';
  } else if (review?.status === 'archived') {
    currentStep = 4; stepsStatus = 'finish'; nextActionText = '该评审已归档';
  } else if (review?.status === 'failed') {
    stepsStatus = 'error'; currentStep = data ? 3 : 1; nextActionText = '评审失败';
  }

  const timelineModule = review ? (
    <Card style={{ marginBottom: 24 }} styles={{ body: { padding: '16px 24px' } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Text strong style={{ fontSize: 16 }}>评审进度</Typography.Text>
        <Typography.Text type={stepsStatus === 'error' ? 'danger' : 'secondary'}>{nextActionText}</Typography.Text>
      </div>
      <Steps current={currentStep} status={stepsStatus} size="small" items={[
        { title: '创建评审' }, { title: '开始诊断' }, { title: '确认评审团' }, { title: '进入评审会议' }, { title: '生成评审报告' },
      ]} />
    </Card>
  ) : null;

  const enabledCount = selected.filter((r) => r.enabled).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>评审诊断</Title>
        <Space>
          {review?.status === 'created' && !data && (
            <Button type="primary" loading={diagnosing} onClick={handleDiagnose}>
              {diagnosing ? '诊断中...' : '开始诊断'}
            </Button>
          )}
          {review?.status === 'diagnosed' && (
            <Button type="primary" disabled={enabledCount === 0} loading={submitting || saving} onClick={handleSaveAndStart}>
              确认评审团并启动 ({enabledCount})
            </Button>
          )}
          {(review?.status === 'running' || review?.status === 'interrupted' || review?.status === 'summarized') && (
            <Button type="primary" onClick={() => router.push(`/reviews/${reviewId}/meeting`)}>进入会议室</Button>
          )}
          {review?.status === 'completed' && (
            <Button type="primary" onClick={() => router.push(`/reviews/${reviewId}/report`)}>查看评审报告</Button>
          )}
          {review?.status === 'failed' && <Button type="primary" disabled>评审失败</Button>}
        </Space>
      </div>

      {timelineModule}

      {!data ? (
        review?.status === 'created' ? (
          <div style={{ padding: '64px 48px', background: '#fff', borderRadius: 8, textAlign: 'center' }}>
            <Title level={4} style={{ marginBottom: 16, color: '#262626' }}>评审材料已提交，开始您的 AI 架构评审之旅</Title>
            <div style={{ marginBottom: 32, color: '#8c8c8c' }}>点击下方按钮，系统将为您生成风险摘要并推荐专家评审团。</div>
            <Button type="primary" size="large" loading={diagnosing} onClick={handleDiagnose} style={{ width: 200, height: 48, fontSize: 16 }}>
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
          <Col span={14}>
            <Card title="架构摘要" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <Space size={[0, 8]} wrap>
                  {data.tags.map((tag: string) => (<Tag color="blue" key={tag}>{tag}</Tag>))}
                </Space>
                <div style={{ fontWeight: 'bold' }}>
                  置信度: <Tag color={data.confidenceScore > 80 ? 'success' : 'warning'}>{data.confidenceScore}%</Tag>
                </div>
              </div>
              <Paragraph>{data.summary}</Paragraph>
            </Card>
            <Card title="风险雷达 (五维评分)">
              <RadarChart data={data.radarDimensions.map((d) => ({ name: d.name, value: d.score }))} size={260} />
            </Card>
          </Col>
          <Col span={10}>
            <Card
              title={<span>评审团 <Tag color={enabledCount > 0 ? 'blue' : 'default'}>{enabledCount} 已选</Tag></span>}
              extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>开关控制是否参与评审，滑块调整权重</Typography.Text>}
            >
              {selected.length === 0 ? (
                <Empty description="暂无可选评审员" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                selected.map((role) => (
                  <Card
                    type="inner"
                    key={role.roleId}
                    style={{ marginBottom: 12, borderColor: role.enabled ? '#6366f1' : undefined, opacity: role.enabled ? 1 : 0.55 }}
                    styles={{ body: { padding: '12px 14px' } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: role.enabled ? 8 : 0 }}>
                      <Switch
                        size="small"
                        checked={role.enabled}
                        onChange={(v) => setSelected((prev) => prev.map((r) => r.roleId === role.roleId ? { ...r, enabled: v } : r))}
                      />
                      <Avatar size={28} style={{ backgroundColor: hashColor(role.roleCode), fontSize: 12 }}>{role.roleCode.charAt(0)}</Avatar>
                      <div style={{ flex: 1 }}>
                        <Space size={4}>
                          <span style={{ fontWeight: 500 }}>{getRoleDisplayName(role.roleCode, role.roleName)}</span>
                          <Tag style={{ fontSize: 11 }}>{role.roleCode}</Tag>
                          {!role.removable && <Tag color="orange" style={{ fontSize: 11 }}>预设</Tag>}
                        </Space>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1', minWidth: 36, textAlign: 'right' }}>{role.weight}%</span>
                    </div>
                    {role.enabled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 38 }}>
                        <Slider
                          style={{ flex: 1 }}
                          min={0} max={100} value={role.weight}
                          onChange={(v) => setSelected((prev) => prev.map((r) => r.roleId === role.roleId ? { ...r, weight: v } : r))}
                          tooltip={{ formatter: (v) => `${v}%` }}
                        />
                        <InputNumber min={0} max={100} value={role.weight} size="small" style={{ width: 60 }}
                          onChange={(v) => setSelected((prev) => prev.map((r) => r.roleId === role.roleId ? { ...r, weight: v ?? 50 } : r))}
                        />
                      </div>
                    )}
                    {role.reason && role.enabled && (
                      <div style={{ fontSize: 12, color: '#555', marginTop: 6, paddingLeft: 38 }}>
                        <strong>推荐理由:</strong> {role.reason}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
