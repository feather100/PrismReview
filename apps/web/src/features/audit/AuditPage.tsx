'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Typography, Card, Row, Col, Table, Tag, Input, Space, Alert, Modal, Empty, Spin, Collapse, Button } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiClient, AuditLogItem, AuditLogList } from '../../lib/api-client/client';

const { Title, Text, Paragraph } = Typography;

const COLOR_BY_VERB: Record<string, string> = {
  created: 'green', updated: 'blue', deleted: 'red', archived: 'orange', human_turn: 'purple',
};
const verbOf = (action: string) => action.split('.').pop() ?? action;
const VERB_CN: Record<string, string> = {
  created: '创建', updated: '更新', deleted: '删除', archived: '归档', human_turn: '人工意见',
};

export default function AuditPage() {
  const [data, setData] = useState<AuditLogList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [resourceFilter, setResourceFilter] = useState<string | undefined>();
  const [detailItem, setDetailItem] = useState<AuditLogItem | null>(null);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiClient.listAuditLogs({ page: p, limit: 20, resource: resourceFilter }));
    } catch (e: any) {
      setError(e.message ?? '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [resourceFilter]);

  useEffect(() => { fetchLogs(page); }, [fetchLogs, page]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!keyword.trim()) return data.items;
    const k = keyword.trim().toLowerCase();
    return data.items.filter((it) =>
      [it.action, it.resource, it.resourceId ?? '', it.userId ?? ''].join(' ').toLowerCase().includes(k),
    );
  }, [data, keyword]);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayCount = data
    ? data.items.filter((it) => new Date(it.createdAt).toLocaleDateString('en-CA') === todayStr).length
    : 0;

  const resources = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.resource))),
    [data],
  );

  const columns: ColumnsType<AuditLogItem> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (d: string) => <Text style={{ fontSize: 13 }}>{new Date(d).toLocaleString('zh-CN')}</Text>,
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      width: 220,
      render: (a: string) => {
        const verb = verbOf(a);
        return <Tag color={COLOR_BY_VERB[verb] ?? 'default'}>{VERB_CN[verb] ?? verb} · {a}</Tag>;
      },
    },
    {
      title: '资源',
      dataIndex: 'resource',
      key: 'resource',
      width: 100,
      render: (r: string) => <Tag>{r}</Tag>,
    },
    {
      title: '资源 ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
      width: 120,
      render: (v: string | null) => (v ? <Text code style={{ fontSize: 12 }}>{v.slice(0, 8)}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: '操作人',
      dataIndex: 'userId',
      key: 'userId',
      width: 120,
      render: (v: string | null) => (v ? <Text code style={{ fontSize: 12 }}>{v.slice(0, 8)}</Text> : <Text type="secondary">SYSTEM</Text>),
    },
    {
      title: '',
      key: 'op',
      width: 70,
      render: (_: unknown, row: AuditLogItem) => (
        <Button type="link" size="small" onClick={() => setDetailItem(row)}>详情</Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>审计日志 <AuditOutlined /></Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          全链路操作留痕 · 来源可追溯 · 日志不可篡改。覆盖评审会 / 用户 / 角色 / 知识库等所有实体的写操作。
        </Paragraph>
      </div>

      <Collapse
        bordered={false}
        items={[{
          key: 'info',
          label: '动作类型说明 — 写操作才会留痕（POST / PATCH / DELETE）',
          children: (
            <Row gutter={16}>
              <Col span={8}><Text strong>review.created / .archived</Text> — 评审会创建与归档。</Col>
              <Col span={8}><Text strong>review.human_turn</Text> — 人类评审员注入意见（HITL）。</Col>
              <Col span={8}><Text strong>user.updated / .role_changed</Text> — 用户资料与平台角色变更。</Col>
            </Row>
          ),
        }]}
      />

      <Row gutter={[16, 16]}>
        <Col xs={12} md={8}>
          <Card><Space direction="vertical"><Text type="secondary">总事件数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{data?.total ?? '—'}</Text></Space></Card>
        </Col>
        <Col xs={12} md={8}>
          <Card><Space direction="vertical"><Text type="secondary">今日事件</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>{loading ? '—' : todayCount}</Text></Space></Card>
        </Col>
        <Col xs={12} md={8}>
          <Card><Space direction="vertical"><Text type="secondary">资源类型</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : resources.length}</Text></Space></Card>
        </Col>
      </Row>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={() => fetchLogs(page)}>重试</Button>} />}

      <Card title="日志列表">
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            placeholder="搜索 action / resource / userId"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 260 }}
          />
          <Space size={4}>
            <Button type={!resourceFilter ? 'primary' : 'text'} size="small" onClick={() => { setResourceFilter(undefined); setPage(1); }}>全部</Button>
            {resources.map((r) => (
              <Button key={r} type={resourceFilter === r ? 'primary' : 'text'} size="small" onClick={() => { setResourceFilter(r); setPage(1); }}>{r}</Button>
            ))}
          </Space>
        </Space>

        <Spin spinning={loading}>
          {filtered.length === 0 && !loading ? (
            <Empty description="暂无审计日志" style={{ padding: 48 }} />
          ) : (
            <Table<AuditLogItem>
              columns={columns}
              dataSource={filtered}
              rowKey="id"
              pagination={data ? { current: page, pageSize: 20, total: data.total, onChange: setPage } : false}
            />
          )}
        </Spin>
      </Card>

      <Modal
        title="审计详情 (detail)"
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={<Button onClick={() => setDetailItem(null)}>关闭</Button>}
        width={700}
      >
        {detailItem && (
          <pre style={{ background: '#f8fafc', padding: 16, borderRadius: 8, maxHeight: 500, overflow: 'auto' }}>
            {JSON.stringify(detailItem, null, 2)}
          </pre>
        )}
      </Modal>
    </Space>
  );
}
