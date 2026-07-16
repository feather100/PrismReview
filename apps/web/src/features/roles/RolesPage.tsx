'use client';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Typography, Card, Row, Col, Table, Tag, Avatar, Space, Tooltip, Button, Spin, Alert, Empty, message, Modal, Form, Input, Select,
} from 'antd';
import { PlusOutlined, CopyOutlined, InfoCircleOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiClient, RoleBrief } from '../../lib/api-client/client';
import { getRoleDisplayName } from '../../lib/i18n/role-mapper';
import { useRouter } from 'next/navigation';

const { Title, Text, Paragraph } = Typography;

const ROLE_COLORS: Record<string, string> = {
  CTO: '#0ea5e9', CFO: '#22c55e', PMO: '#a855f7', Compliance: '#ef4444', UserAdvocate: '#f59e0b',
};
const hashColor = (code: string) => ROLE_COLORS[code] ?? '#6366f1';

const PRESET_DIMENSIONS: Record<string, string[]> = {
  CTO: ['架构合理性', '技术可行性', '性能与扩展性', '安全与合规', '技术债务'],
  CFO: ['投入产出分析', '预算合理性', 'ROI评估', '商业风险', '成本效益'],
  PMO: ['交付风险', '排期合理性', '资源协调', '外部依赖', '质量保障'],
  Compliance: ['数据安全与合规', '隐私保护', '法规遵从', '审计可追溯', '跨境合规'],
  UserAdvocate: ['用户体验', '易用性', '无障碍', '反馈闭环', '价值感知'],
};

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ name: string; code: string; dimensions: string[] }>();
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoles(await apiClient.listRoles());
    } catch (e: any) {
      setError(e.message ?? '加载评审团失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const v = await form.validateFields();
      await apiClient.createRole({ name: v.name, code: v.code, dimensions: v.dimensions || [] });
      message.success('角色已创建');
      setOpen(false);
      form.resetFields();
      await fetchRoles();
    } catch (e: any) {
      message.error(e.message ?? '创建失败');
    } finally { setSubmitting(false); }
  };

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
              <Button type="text" size="small" icon={<CopyOutlined />}
                onClick={() => navigator.clipboard?.writeText(v).then(() => message.success('已复制'))} />
            </Tooltip>
          </Space>
        ) : (
          <Text type="secondary">未发布</Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string | undefined, r: RoleBrief) => s === 'disabled'
        ? <Tag icon={<CloseCircleFilled />} color="default">已停用</Tag>
        : <Tag icon={<CheckCircleFilled />} color="success">启用中</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (d: string) => <Text type="secondary">{new Date(d).toLocaleDateString('zh-CN')}</Text>,
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
        <Space>
          <Button onClick={() => router.push('/prompts')}>Prompt 模板</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建角色</Button>
        </Space>
      </div>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={fetchRoles}>重试</Button>} />}

      <Row gutter={[16, 16]}>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">总角色数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : roles.length}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">预设</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#0ea5e9' }}>{loading ? '—' : presetCount}</Text></Space></Card></Col>
        <Col xs={8}><Card><Space direction="vertical"><Text type="secondary">自定义</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{loading ? '—' : customCount}</Text></Space></Card></Col>
      </Row>

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

      <Modal title="新建角色" open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={handleCreate} confirmLoading={submitting} okText="创建" width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="例如：安全审查员" />
          </Form.Item>
          <Form.Item name="code" label="角色代码 (大写英文)" rules={[{ required: true, message: '请输入角色代码' }]}>
            <Input placeholder="SECURITY" onChange={(e) => form.setFieldValue('code', e.target.value.toUpperCase())} />
          </Form.Item>
          <Form.Item name="dimensions" label="审查维度">
            <Select mode="tags" placeholder="例如：架构合理性 / 成本 / 合规" options={[
              { value: '架构合理性' }, { value: '技术可行性' }, { value: '性能与扩展性' },
              { value: '安全与合规' }, { value: '投入产出分析' }, { value: '成本效益' },
              { value: '交付风险' }, { value: '用户体验' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
