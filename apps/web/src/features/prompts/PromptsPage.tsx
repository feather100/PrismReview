'use client';
import React, { useState } from 'react';
import { Typography, Card, Row, Col, Table, Tag, Button, Space, Tooltip, message, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;

interface Template {
  id: string;
  name: string;
  layer: 'base' | 'task' | 'context' | 'format';
  version: string;
  role: string;
  updatedAt: string;
  active: boolean;
}

// 演示数据 — 实际列表将由新的 /api/prompt-templates 接口（规划中）提供。
const MOCK: Template[] = [
  { id: '1', name: '技术审核员 · 角色基底', layer: 'base', version: 'v2.1', role: 'CTO', updatedAt: '2026-07-10', active: true },
  { id: '2', name: '商业分析 · 任务层',   layer: 'task', version: 'v1.3', role: 'CFO', updatedAt: '2026-07-08', active: true },
  { id: '3', name: '结构化输出 · 格式层', layer: 'format', version: 'v1.0', role: '通用', updatedAt: '2026-06-20', active: true },
  { id: '4', name: 'Moderator 收敛 · 任务层', layer: 'task', version: 'v3.2', role: 'Moderator', updatedAt: '2026-07-12', active: true },
  { id: '5', name: '项目上下文注入',     layer: 'context', version: 'v1.0', role: '通用', updatedAt: '2026-05-30', active: false },
];

const LAYER_COLOR: Record<string, string> = { base: 'blue', task: 'orange', context: 'purple', format: 'cyan' };
const LAYER_CN: Record<string, string> = { base: 'base · 角色基底', task: 'task · 任务层', context: 'context · 上下文层', format: 'format · 格式层' };

export default function PromptsPage() {
  const [tpls] = useState<Template[]>(MOCK);
  const columns: ColumnsType<Template> = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: string, r) => <Space direction="vertical" size={0}><Text strong>{t}</Text><Text type="secondary" style={{ fontSize: 12 }}>{LAYER_CN[r.layer]}</Text></Space> },
    { title: '层', dataIndex: 'layer', key: 'layer', width: 140, render: (l: string) => <Tag color={LAYER_COLOR[l]}>{l}</Tag> },
    { title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (v: string) => <Text code>{v}</Text> },
    { title: '角色', dataIndex: 'role', key: 'role', width: 120, render: (r: string) => <Tag>{r}</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, render: (d: string) => <Text type="secondary">{d}</Text> },
    {
      title: '状态',
      dataIndex: 'active',
      key: 'active',
      width: 100,
      render: (a: boolean) => <Tag color={a ? 'green' : 'default'}>{a ? '激活' : '历史'}</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 140,
      render: (_: unknown, r: Template) => (
        <Space>
          <Button type="link" size="small" onClick={() => message.info(`模板详情：${r.name}（占位）`)}>详情</Button>
          {!r.active && <Button type="link" size="small" onClick={() => message.info(`回滚到 ${r.version}（占位）`)}>回滚</Button>}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>Prompt 模板注册表</Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            四层组装 (base · task · context · format) + 版本化 + 可回滚。变更 Prompt 模板 = 影响后续每一轮评审的发言指令。
          </Paragraph>
        </Space>
        <Tooltip title="注册新模板（规划中，待增加后台端点）">
          <Button type="primary" disabled>+ 注册模板</Button>
        </Tooltip>
      </div>

      <Alert
        type="info"
        showIcon
        message="当前展示来自本地演示数据 — 后端 /api/prompt-templates Sprint B 就绪后将自动切换为真实数据。"
        closable
      />

      <Row gutter={[16, 16]}>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">模板总数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{tpls.length}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">激活版本数</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{tpls.filter((t) => t.active).length}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">角色覆盖</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{new Set(tpls.map((t) => t.role)).size}</Text></Space></Card>
        </Col>
      </Row>

      <Card>
        <Table<Template> columns={columns} dataSource={tpls} rowKey="id" pagination={false} />
      </Card>
    </Space>
  );
}
