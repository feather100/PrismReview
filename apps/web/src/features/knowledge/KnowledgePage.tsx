'use client';
import React, { useEffect, useState } from 'react';
import {
  Typography, Card, Row, Col, Table, Tag, Button, Space, Alert, Modal, Input, Select, Spin, Empty, message,
} from 'antd';
import { PlusOutlined, ExperimentOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { apiClient, KnowledgeDocument } from '../../lib/api-client/client';

const { Title, Text, Paragraph } = Typography;

const STATUS_COLOR: Record<string, string> = { processed: 'green', pending: 'default', indexing: 'processing', failed: 'red' };

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchDocs = async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await apiClient.listKnowledge());
    } catch (e: any) {
      setError(e.message ?? '加载知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  const columns: ColumnsType<KnowledgeDocument> = [
    { title: '标题', dataIndex: 'title', key: 'title', render: (t: string) => <Text strong>{t}</Text> },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (s: string) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{s}</Tag>,
    },
    { title: '切片数', dataIndex: 'chunkCount', key: 'chunkCount', width: 100 },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (d: string) => <Text type="secondary">{new Date(d).toLocaleDateString('zh-CN')}</Text>,
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Space direction="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>知识库 <ExperimentOutlined /></Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            管理 RAG 知识源文档。文档需经过 Parse → Embed → Chunk 后，才能被评审会 Moderator 在 tool 调用中按需检索。
          </Paragraph>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>上传文档</Button>
      </div>

      <Alert
        type="warning"
        showIcon
        message="MCP Tool 层接入中"
        description="知识库文档检索作为评审会工具层的一部分，待 P4 MCP Tool 接口正式启用后生效；上传文档接口当前为占位。"
        closable
      />

      <Row gutter={[16, 16]}>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">文档总数</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{loading ? '—' : docs.length}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">已索引</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{loading ? '—' : docs.filter((d) => d.status === 'processed').length}</Text></Space></Card>
        </Col>
        <Col xs={8}>
          <Card><Space direction="vertical"><Text type="secondary">待处理</Text><Text style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{loading ? '—' : docs.filter((d) => d.status !== 'processed').length}</Text></Space></Card>
        </Col>
      </Row>

      {error && <Alert message="加载失败" description={error} type="error" showIcon closable onClose={() => setError(null)} action={<Button onClick={fetchDocs}>重试</Button>} />}

      <Card>
        <Spin spinning={loading}>
          {docs.length === 0 && !loading ? (
            <Empty description="还没有文档" style={{ padding: 48 }}>
              <Text type="secondary">接入 MCP Tool 后即可通过「上传文档」加入自定义知识源。</Text>
            </Empty>
          ) : (
            <Table<KnowledgeDocument> columns={columns} dataSource={docs} rowKey="id" pagination={false} />
          )}
        </Spin>
      </Card>

      {/* Upload modal — placeholder (no backend wiring yet, per P4 plan) */}
      <Modal
        title="上传文档 (WIP)"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={() => { message.success('上传已排队（演示）'); setUploadOpen(false); }}
        okText="提交（演示）"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div><Text strong>标题</Text><Input placeholder="例：企业级微服务规范 v2.1" style={{ marginTop: 4 }} /></div>
          <div>
            <Text strong>类型</Text>
            <Select defaultValue="pdf" style={{ width: '100%', marginTop: 4 }} options={[{ value: 'pdf', label: 'PDF' }, { value: 'markdown', label: 'Markdown' }, { value: 'docx', label: 'Word (docx)' }]} />
          </div>
          <div>
            <Text strong>来源</Text>
            <Select defaultValue="local" style={{ width: '100%', marginTop: 4 }} options={[{ value: 'local', label: '本机文件' }, { value: 'url', label: '外部链接' }]} />
          </div>
          <Alert type="info" message="实际上传交由 MCP Tool 层的 parse_document job 处理；当前点击仅发送演示成功提示。" showIcon />
        </Space>
      </Modal>
    </Space>
  );
}
