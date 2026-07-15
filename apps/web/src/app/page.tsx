'use client';
import React, { useEffect, useState } from 'react';
import {
  Typography, Card, Row, Col, Statistic, Button, Space, Tag, Empty, Spin, Alert, message, Tooltip,
} from 'antd';
import { useRouter } from 'next/navigation';
import {
  FileSearchOutlined, AuditOutlined, TeamOutlined, AppstoreOutlined, BookOutlined,
  PlusOutlined, ArrowRightOutlined, BulbOutlined, ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { apiClient, ReviewListItem, ReportResponse } from '../lib/api-client/client';
import { getRoleDisplayName } from '../lib/i18n/role-mapper';
import StatCard from '../components/dashboard/StatCard';

const { Title, Text, Paragraph } = Typography;

const STATUS_COLOR: Record<string, string> = {
  created: '#94a3b8',
  diagnosed: '#0ea5e9',
  running: '#6366f1',
  interrupted: '#f59e0b',
  summarized: '#6366f1',
  completed: '#22c55e',
  failed: '#ef4444',
  aborted: '#f59e0b',
  archived: '#94a3b8',
};

const QUICK_CTAS = [
  { label: '返回评审中心', icon: <FileSearchOutlined />, path: '/reviews' },
  { label: '评审团', icon: <TeamOutlined />, path: '/roles' },
  { label: '审计日志', icon: <AuditOutlined />, path: '/audit' },
  { label: 'Prompt 模板', icon: <AppstoreOutlined />, path: '/prompts' },
  { label: '知识库', icon: <BookOutlined />, path: '/knowledge' },
  { label: 'Workflow 预设', icon: <BulbOutlined />, path: '/workflows' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [stats, setStats] = useState<{ total: number; active: number; completed: number; p0: number } | null>(null);
  const [recent, setRecent] = useState<ReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [allRes, completedRes, activeRes, reports] = await Promise.allSettled([
        apiClient.getReviews({ limit: 1 }),
        apiClient.getReviews({ status: 'completed', limit: 1 }),
        apiClient.getReviews({ status: 'running,interrupted,summarized', limit: 50 }),
        apiClient.getReviews({ limit: 5, status: 'completed' }), // reports preview
      ]);

      const allTotal = allRes.status === 'fulfilled' ? allRes.value.total : 0;
      const completedTotal = completedRes.status === 'fulfilled' ? completedRes.value.total : 0;
      const activeItems = activeRes.status === 'fulfilled' ? activeRes.value.items : [];
      const recentItems = reports.status === 'fulfilled' ? reports.value.items : [];

      // Sample P0 across first page of completed reviews (cap to keep it cheap).
      let p0 = 0;
      for (const item of recentItems.slice(0, 5)) {
        try {
          const r: ReportResponse = await apiClient.getReport(item.id);
          p0 += r.metrics?.p0RiskCount ?? 0;
        } catch { /* skip unreportable */ }
      }

      setStats({ total: allTotal, completed: completedTotal, active: activeItems.length, p0 });
      setRecent(recentItems);
    } catch (e: any) {
      setErr(e.message ?? '加载仪表盘失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleCreate = () => {
    // 导航到新建评审表单页 — 让用户填材料、选 Provider（mock/LongCat/LM Studio）
    router.push('/reviews/new');
  };

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* Hero */}
      <Card
        style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 60%, #a78bfa 100%)',
          color: '#fff',
          border: 'none',
        }}
        styles={{ body: { padding: '32px 36px' } }}
      >
        <Row align="middle" gutter={24} justify="space-between">
          <Col flex="auto">
            <Title level={2} style={{ color: '#fff', margin: 0 }}>你好，欢迎回来 👋</Title>
            <Paragraph style={{ color: 'rgba(255,255,255,0.85)', marginTop: 8, marginBottom: 20, maxWidth: 560 }}>
              PrismReview 的 AI 评审团已就绪。把一份方案丢进去，多专家多轮辩论，
              由 AI Moderator 收敛出一份可量化、可溯源的正式评审报告。
            </Paragraph>
            <Space>
              <Button type="primary" size="large" icon={<PlusOutlined />} onClick={handleCreate} loading={creating}>
                创建新评审
              </Button>
              <Button size="large" ghost style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}
                icon={<FileSearchOutlined />} onClick={() => router.push('/reviews')}>
                评审中心
              </Button>
            </Space>
          </Col>
          <Col xs={0} md={0} lg={8} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space direction="vertical" align="center" size={0}>
              <ThunderboltOutlined style={{ fontSize: 72, color: 'rgba(255,255,255,0.35)' }} />
              <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Zero-config mock demo</Text>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Stats */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <StatCard title="评审总数" value={stats?.total ?? 0} loading={loading}
            accent="#6366f1" icon={<FileSearchOutlined />} onClick={() => router.push('/reviews')} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="进行中" value={stats?.active ?? 0} loading={loading}
            accent="#f59e0b" icon={<ReloadOutlined spin={loading} />} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="已完成" value={stats?.completed ?? 0} loading={loading}
            accent="#22c55e" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="P0 风险（近 5 份）" value={stats?.p0 ?? 0} loading={loading}
            accent="#ef4444" icon={<AuditOutlined />} />
        </Col>
      </Row>

      {err && <Alert message="加载失败" description={err} type="warning" showIcon closable onClose={() => setErr(null)} />}

      {/* Quick actions */}
      <Card title="快速入口" styles={{ body: { padding: '8px 0' } }}>
        <Row gutter={[16, 16]} style={{ padding: '8px 24px' }}>
          {QUICK_CTAS.map((c) => (
            <Col xs={12} md={8} lg={4} key={c.path}>
              <Card hoverable size="small" onClick={() => router.push(c.path)}
                style={{ borderRadius: 12, textAlign: 'center', cursor: 'pointer' }}>
                <Space direction="vertical" size={8}>
                  <span style={{ fontSize: 22, color: '#6366f1' }}>{c.icon}</span>
                  <Text style={{ fontSize: 13 }}>{c.label}</Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Recent reviews */}
      <Card
        title="最近评审"
        extra={<Button type="link" icon={<ArrowRightOutlined />} onClick={() => router.push('/reviews')}>查看全部</Button>}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin tip="加载中…" /></div>
        ) : recent.length === 0 ? (
          <Empty description="还没有评审" style={{ padding: 40 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} loading={creating}>
              创建第一个评审
            </Button>
          </Empty>
        ) : (
          <Row gutter={[16, 16]}>
            {recent.map((r) => (
              <Col xs={24} md={12} lg={8} key={r.id}>
                <Card hoverable onClick={() => router.push(`/reviews/${r.id}`)}
                  style={{ borderRadius: 12 }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text strong style={{ fontSize: 15 }}>{r.title || '(未命名)'}</Text>
                    <Paragraph type="secondary" ellipsis style={{ marginBottom: 8, fontSize: 13, minHeight: 36 }}>
                      {r.objective}
                    </Paragraph>
                    <Space split={<span style={{ color: '#e2e8f0' }}>·</span>}>
                      <Tag color={STATUS_COLOR[r.status] ?? '#94a3b8'} style={{ marginInlineEnd: 0 }}>
                        {r.status}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(r.updatedAt).toLocaleDateString('zh-CN')}
                      </Text>
                    </Space>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </Space>
  );
}
