'use client';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Typography, Card, Row, Col, Table, Tag, Button, Space, message, Modal, Form, Input, Select, Alert, Empty, Spin, Collapse,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient, PromptTemplate } from '../../lib/api-client/client';

const { Title, Text, Paragraph } = Typography;

const LAYER_COLOR: Record<string, string> = { base: 'blue', task: 'orange', context: 'purple', format: 'cyan' };
const LAYER_CN: Record<string, string> = { base: 'base · 角色基底', task: 'task · 任务层', context: 'context · 上下文层', format: 'format · 格式层' };
const ROLE_CODES = ['CTO', 'CFO', 'PMO', 'Compliance', 'UserAdvocate', '通用', 'Moderator'];
const LAYERS: PromptTemplate['layer'][] = ['base', 'task', 'context', 'format'];

export default function PromptsPage() {
  const [tpls, setTpls] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [histOpen, setHistOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<PromptTemplate[]>([]);
  const [form] = Form.useForm<{ roleCode: string; layer: string; content: string; description: string }>();
  const [submitting, setSubmitting] = useState(false);

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTpls(await apiClient.listPrompts());
    } catch (e: any) {
      setError(e.message ?? '加载 Prompt 模板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const handleRegister = async () => {
    setSubmitting(true);
    try {
      const v = await form.validateFields();
      await apiClient.registerPrompt({
        roleCode: v.roleCode,
        layer: v.layer,
        content: v.content,
        description: v.description || '',
      });
      message.success('模板已注册');
      setOpen(false);
      form.resetFields();
      await fetchPrompts();
    } catch (e: any) {
      message.error(e.message ?? '注册失败');
    } finally { setSubmitting(false); }
  };

  const handleRollback = async (roleCode: string, layer: string, version: string) => {
    try {
      await apiClient.rollbackPrompt(roleCode, layer, version);
      message.success(`已回滚到 ${version}`);
      await fetchPrompts();
    } catch (e: any) {
      message.error(e.message ?? '回滚失败');
    }
  };

  const handleViewHistory = async (roleCode: string, layer: string) => {
    setHistOpen(roleCode + '/' + layer);
    try {
      setHistory(await apiClient.promptHistory(roleCode, layer));
    } catch { /* ignore */ }
  };

  const activeCount = tpls.filter((t) => {
    // 无显式 active 字段：按 (roleCode+layer) 取最新版本视为激活
    const latest = tpls.filter((x) => x.roleCode === t.roleCode && x.layer === t.layer).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest?.id === t.id;
  }).length;

  const columns: ColumnsType<PromptTemplate> = [
    { title: '名称', dataIndex: 'roleCode', key: 'name', render: (_t: string, r) => <Space direction="vertical" size={0}><Text strong>{r.roleCode}</Text><Text type="secondary" style={{ fontSize: 12 }}>{LAYER_CN[r.layer]}</Text></Space> },
    { title: '层', dataIndex: 'layer', key: 'layer', width: 140, render: (l: string) => <Tag color={LAYER_COLOR[l]}>{l}</Tag> },
    { title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (v: string) => <Text code>{v}</Text> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (d: string) => <Text type="secondary">{new Date(d).toLocaleDateString('zh-CN')}</Text> },
    {
      title: '操作', key: 'op', width: 170, render: (_: unknown, r) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleViewHistory(r.roleCode, r.layer)}>历史</Button>
          <Button type="link" size="small" onClick={() => handleRollback(r.roleCode, r.layer, r.version)}>回滚</Button>
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
        <Button type="primary" onClick={() => setOpen(true)}>+ 注册模板</Button>
      </div>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={fetchPrompts}>重试</Button>} />}

      <Row gutter={[16, 16]}>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">注册总数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : tpls.length}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">激活模板</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{loading ? '—' : activeCount}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">角色覆盖</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : new Set(tpls.map((t) => t.roleCode)).size}</Text></Space></Card></Col>
      </Row>

      <Card>
        <Spin spinning={loading}>
          {tpls.length === 0 && !loading ? (
            <Empty description="还没有注册 Prompt 模板" style={{ padding: 48 }}>
              <Button type="primary" onClick={() => setOpen(true)}>注册第一个模板</Button>
            </Empty>
          ) : (
            <Table<PromptTemplate> columns={columns} dataSource={tpls} rowKey="id" pagination={false} />
          )}
        </Spin>
      </Card>

      <Modal title="注册 Prompt 模板" open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={handleRegister} confirmLoading={submitting} okText="注册" width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="roleCode" label="角色 (roleCode)" rules={[{ required: true }]}>
            <Select mode="tags" options={ROLE_CODES.map((c) => ({ value: c, label: c }))} placeholder="选择或输入角色编码" />
          </Form.Item>
          <Form.Item name="layer" label="层 (layer)" rules={[{ required: true }]} initialValue="base">
            <Select options={LAYERS.map((l) => ({ value: l, label: LAYER_CN[l] }))} />
          </Form.Item>
          <Form.Item name="content" label="模板内容" rules={[{ required: true, message: '请输入 Prompt 模板内容' }]}>
            <Input.TextArea rows={8} placeholder="输入该层级的 Prompt 模板文本，支持变量占位如 {{objective}}" />
          </Form.Item>
          <Form.Item name="description" label="变更说明">
            <Input placeholder="例：新增安全审查维度" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`版本历史 ${histOpen ?? ''}`} open={!!histOpen} onCancel={() => setHistOpen(null)} footer={null} width={700}>
        <Table<PromptTemplate>
          size="small"
          columns={[
            { title: '版本', dataIndex: 'version', key: 'v', width: 80 },
            { title: '创建时间', dataIndex: 'createdAt', key: 'd', width: 160, render: (d: string) => new Date(d).toLocaleString('zh-CN') },
            { title: '内容预览', dataIndex: 'content', key: 'c', render: (c: string) => <Text ellipsis style={{ maxWidth: 300 }}>{c.slice(0, 60)}</Text> },
          ]}
          dataSource={history}
          rowKey="id"
          pagination={false}
        />
      </Modal>
    </Space>
  );
}
