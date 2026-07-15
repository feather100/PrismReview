'use client';
import React, { useEffect, useState } from 'react';
import {
  Typography, Card, Row, Col, Table, Tag, Avatar, Space, Tooltip, Button, Spin, Alert, Empty, message, Collapse, Modal,
} from 'antd';
import { PlusOutlined, CopyOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiClient, RoleBrief } from '../../lib/api-client/client';
import { getRoleDisplayName } from '../../lib/i18n/role-mapper';

const { Title, Text, Paragraph } = Typography;

const ROLE_COLORS: Record<string, string> = {
  CTO: '#0ea5e9', CFO: '#22c55e', PMO: '#a855f7', Compliance: '#ef4444', UserAdvocate: '#f59e0b',
};
const hashColor = (code: string) => ROLE_COLORS[code] ?? '#6366f1';

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      setRoles(await apiClient.listRoles());
    } catch (e: any) {
      setError(e.message ?? '加载评审团失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoles(); }, []);

  const presetCount = roles.filter((r) => r.isPreset).length;
  const customCount = roles.length - presetCount;

  const columns: ColumnsType<RoleBrief> = [
    {
      title: '角色',
      dataIndex: 'name',
      key: 'name',
      render: (_text: string, row: RoleBrief) => (
        <Space>
          <Avatar size={36} style={{ backgroundColor: hashColor(row.code), fontWeight: 600 }}>{row.code.charAt(0)}</Avatar>
          <Space direction="vertical" size={0}>
            <Text strong>{getRoleDisplayName(row.code, row.name)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'isPreset',
      key: 'isPreset',
      render: (isPreset: boolean) => (
        <Tag color={isPreset ? 'blue' : 'green'}>{isPreset ? '预设' : '自定义'}</Tag>
      ),
    },
    {
      title: '激活版本',
      dataIndex: 'activeVersionId',
      key: 'activeVersionId',
      render: (v: string | null) =>
        v ? (
          <Space size={4}>
            <Text code style={{ fontSize: 12 }}>{v.slice(0, 8)}</Text>
            <Tooltip title="复制版本 ID">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  if (typeof navigator !== 'undefined') {
                    navigator.clipboard?.writeText(v).then(
                      () => message.success('已复制'),
                      () => message.error('复制失败'),
                    );
                  }
                }}
              />
            </Tooltip>
          </Space>
        ) : (
          <Text type="secondary">未发布</Text>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (d: string) => <Text type="secondary">{new Date(d).toLocaleDateString('zh-CN')}</Text>,
    },
    {
      title: '操作',
      key: 'op',
      render: (_: unknown, row: RoleBrief) => (
        <Space>
          <Button type="link" size="small" onClick={() => message.info(`角色详情 ${row.code}（占位）`)}>详情</Button>
          <Button type="link" size="small" onClick={() => message.info(`版本历史 ${row.code}（占位）`)}>版本</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>评审团</Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            管理参与多轮辩论的 AI 专家 — 选择 / 组合 / 配置版本，直接影响评审会深度与收敛方向。
          </Paragraph>
        </Space>
        <Tooltip title="新建角色（待对接后端创建接口）">
          <Button type="primary" icon={<PlusOutlined />} disabled>新建角色</Button>
        </Tooltip>
      </div>

      <Card styles={{ body: { padding: 0 } }}>
        <Collapse
          bordered={false}
          defaultActiveKey={['info']}
          items={[{
            key: 'info',
            label: <Space><InfoCircleOutlined /> 预设 vs 自定义角色</Space>,
            children: (
              <Row gutter={16} style={{ paddingBottom: 8 }}>
                <Col span={12}><Text strong>预设角色</Text><Paragraph type="secondary" style={{ marginBottom: 0 }}>CTO / CFO / PMO / Compliance / UserAdvocate。覆盖典型架构评审维度，即装即用，不可删除。</Paragraph></Col>
                <Col span={12}><Text strong>自定义角色</Text><Paragraph type="secondary" style={{ marginBottom: 0 }}>按需扩展审查视角（如云成本优化师、SRE 稳定性审查员等），每个自定义角色独立版本化。</Paragraph></Col>
              </Row>
            ),
          }]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">总角色数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : roles.length}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">预设</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#0ea5e9' }}>{loading ? '—' : presetCount}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">自定义</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{loading ? '—' : customCount}</Text></Space></Card>
        </Col>
      </Row>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={fetchRoles}>重试</Button>} />}

      <Card>
        <Spin spinning={loading}>
          {roles.length === 0 && !loading ? (
            <Empty description="暂无角色" style={{ padding: 48 }}>
              <Text type="secondary">评审团列表为空 — 后端 seed 数据可能未执行</Text>
            </Empty>
          ) : (
            <Table<RoleBrief> columns={columns} dataSource={roles} rowKey="id" pagination={false} style={{ borderRadius: 12, overflow: 'hidden' }} />
          )}
        </Spin>
      </Card>
    </Space>
  );
}
