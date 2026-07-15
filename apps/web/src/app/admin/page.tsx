'use client';
import React, { useEffect, useState } from 'react';
import { Typography, Card, Row, Col, Table, Tag, Button, Space, Alert, Empty, Spin, message, Modal, Form, Input, Select, Popconfirm, App } from 'antd';
import { useProviderStore, LlmProvider } from '../../lib/stores/providerStore';
import { CheckCircleFilled, CloseCircleFilled, QuestionCircleFilled, ApiOutlined, PlusOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const STATUS_COLOR: Record<string, string> = { ready: 'success', unreachable: 'error', unknown: 'default' };
const STATUS_LABEL: Record<string, string> = { ready: '可用', unreachable: '不可达', unknown: '未测试' };

export default function AdminPage() {
  const { providers, active, envConfigured, loading, load, test, activate, remove, create, testingId } = useProviderStore();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { modal } = App.useApp();

  useEffect(() => { load(); }, [load]);

  const handleTest = async (id: string) => {
    const r = await test(id);
    message.info(r.status === 'ready' ? `连接成功 (${r.latencyMs}ms)` : `连接失败: ${r.message}`);
  };

  const handleActivate = async (id: string) => { await activate(id); message.success('已激活'); };
  const handleDelete = async (id: string) => {
    try { await remove(id); message.success('已删除'); }
    catch (e: any) { message.error(e.message ?? '删除失败'); }
  };

  const handleCreate = async () => {
    const v = await form.validateFields();
    try {
      await create({ name: v.name, provider: v.provider, model: v.model, baseUrl: v.baseUrl, apiKey: v.apiKey, activate: v.activate });
      message.success('Provider 已添加');
      setOpen(false);
      form.resetFields();
    } catch (e: any) { message.error(e.message ?? '添加失败'); }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (n: string, r: LlmProvider) => <Space>{n}{r.isActive && <Tag color="blue">当前激活</Tag>}</Space> },
    { title: '类型', dataIndex: 'provider', key: 'provider', width: 120, render: (p: string) => <Tag>{p}</Tag> },
    { title: '模型', dataIndex: 'model', key: 'model', width: 160 },
    { title: 'Base URL', dataIndex: 'baseUrl', key: 'url', render: (u: string) => <Text code style={{ fontSize: 12 }}>{u}</Text> },
    { title: 'API Key', dataIndex: 'hasApiKey', key: 'key', width: 100, render: (has: boolean, r: LlmProvider) => has ? <Text code>{r.apiKeyMasked || '••••'}</Text> : <Text type="secondary">—</Text> },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const Icon = s === 'ready' ? CheckCircleFilled : s === 'unreachable' ? CloseCircleFilled : QuestionCircleFilled;
        return <Tag icon={<Icon />} color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>;
      },
    },
    {
      title: '操作', key: 'op', width: 200,
      render: (_: unknown, r: LlmProvider) => (
        <Space>
          <Button size="small" loading={testingId === r.id} onClick={() => handleTest(r.id)}>测试</Button>
          {!r.isActive && <Button size="small" type="primary" ghost onClick={() => handleActivate(r.id)}>激活</Button>}
          {!r.isActive && <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}><Button size="small" danger>删除</Button></Popconfirm>}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}><ApiOutlined /> LLM Provider 管理</Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>管理 AI 模型 Provider。API Key 加密存储，前端永不展示明文。</Paragraph>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>添加 Provider</Button>
      </div>

      {envConfigured && <Alert type="info" showIcon message="检测到 .env 中已配置 Provider" description="运行时以 .env 为准。如需运行时切换，请在此页面添加并激活。" closable />}

      <Row gutter={[16, 16]}>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">Provider 总数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{providers.length}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">当前激活</Text><Text style={{ fontSize: 28, fontWeight: 700, color: active ? '#22c55e' : '#94a3b8' }}>{active ? active.name : '—'}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">可用状态</Text><Text style={{ fontSize: 28, fontWeight: 700, color: providers.some((p) => p.status === 'ready') ? '#22c55e' : '#f59e0b' }}>{providers.filter((p) => p.status === 'ready').length}</Text></Space></Card></Col>
      </Row>

      <Card>
        <Spin spinning={loading}>
          {providers.length === 0 && !loading ? (
            <Empty description="还没有配置 Provider" style={{ padding: 48 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>添加第一个 Provider</Button>
            </Empty>
          ) : (
            <Table<LlmProvider> columns={columns} dataSource={providers} rowKey="id" pagination={false} />
          )}
        </Spin>
      </Card>

      <Modal title="添加 Provider" open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={handleCreate} okText="添加" width={560}>
        <Form form={form} layout="vertical" initialValues={{ provider: 'openai_compatible' }}>
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}><Input placeholder="LongCat-2.0" /></Form.Item>
          <Form.Item name="provider" label="Provider 类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'openai_compatible', label: 'OpenAI 兼容 (LongCat / OpenAI / vLLM)' }, { value: 'lmstudio', label: 'LM Studio (本地)' }, { value: 'mock', label: 'Mock (演示)' }]} />
          </Form.Item>
          <Form.Item name="model" label="模型名称" rules={[{ required: true }]}><Input placeholder="LongCat-2.0" /></Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}><Input placeholder="https://api.longcat.chat/openai/v1" /></Form.Item>
          <Form.Item name="apiKey" label="API Key (可选，加密存储)"><Input.Password placeholder="sk-..." autoComplete="new-password" /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
