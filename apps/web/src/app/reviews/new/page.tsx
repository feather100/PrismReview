'use client';
import React, { useEffect, useState } from 'react';
import { Typography, Form, Input, Button, Card, Select, message, Space, Radio, Alert, Divider, Tooltip, Tag } from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient, WorkflowPreset } from '../../../lib/api-client/client';

const { Title, Paragraph } = Typography;

type ProviderType = 'mock' | 'lmstudio' | 'openai_compatible';
interface ProviderConfig { provider: ProviderType; model?: string; baseUrl?: string; apiKey?: string; }

const PROVIDERS: { value: ProviderType; label: string; desc: string }[] = [
  { value: 'mock', label: 'Mock（默认）', desc: '零成本、零配置，专家意见由内置规则生成，适合演示与流程打通' },
  { value: 'lmstudio', label: 'LM Studio（本地）', desc: '调用本地 LM Studio（默认 127.0.0.1:1234，Gemma-4）' },
  { value: 'openai_compatible', label: 'LongCat-2.0（云端）', desc: '调用 LongCat-2.0 兼容 OpenAI 协议，需要 Base URL + API Key' },
];

const LLM_FIELDS: Record<ProviderType, { showModel: boolean; showBaseUrl: boolean; showKey: boolean; defaultModel: string; defaultBaseUrl: string; keyRequired: boolean }> = {
  mock: { showModel: false, showBaseUrl: false, showKey: false, defaultModel: '', defaultBaseUrl: '', keyRequired: false },
  lmstudio: { showModel: true, showBaseUrl: false, showKey: false, defaultModel: 'google/gemma-4-12b', defaultBaseUrl: 'http://127.0.0.1:1234/v1', keyRequired: false },
  openai_compatible: { showModel: true, showBaseUrl: true, showKey: true, defaultModel: 'LongCat-2.0', defaultBaseUrl: 'https://api.longcat.chat/openai/v1', keyRequired: true },
};

const MAX_CONTENT_CHARS = 20000;

export default function NewReviewPage() {
  const [form] = Form.useForm<{ title: string; objective: string; content: string; mode: string; provider: ProviderType; model?: string; baseUrl?: string; apiKey?: string; }>();
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<ProviderType>('mock');
  const [workflows, setWorkflows] = useState<WorkflowPreset[]>([]);
  const [availProviders, setAvailProviders] = useState<Record<string, boolean>>({ mock: true, lmstudio: true, openai_compatible: true });
  const [langMode, setLangMode] = useState<'auto' | 'zh' | 'en'>('auto');
  const router = useRouter();

  // 拉取可用 workflow
  useEffect(() => {
    apiClient.listWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  const meta = LLM_FIELDS[provider];

  const handleFinish = async (values: any) => {
    setLoading(true);
    const payload: any = {
      title: values.title,
      objective: values.objective,
      content: values.content,
      mode: values.mode ?? 'round_robin',
    };
    if (provider !== 'mock') {
      payload.provider = {
        provider,
        ...(meta.showModel && values.model ? { model: values.model } : {}),
        ...(meta.showBaseUrl && values.baseUrl ? { baseUrl: values.baseUrl } : {}),
        ...(meta.showKey && values.apiKey ? { apiKey: values.apiKey.trim() } : {}),
      };
    }
    // 语言：auto → laisser le backend détecter ; zh/en → forcer
    if (langMode !== 'auto') payload.lang = langMode;
    try {
      const review = await apiClient.createReview(payload);
      message.success(`评审已创建 — provider=${payload.provider?.provider ?? 'mock'}`);
      router.push(`/reviews/${review.id}`);
    } catch (err: any) {
      message.error(err.message ?? '创建评审失败');
    } finally { setLoading(false); }
  };

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>新建评审</Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          提交方案材料，系统将自动诊断、推荐评审团，多轮辩论后产出正式评审报告。所有字段材料都会落库并参与评审。
        </Paragraph>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{ mode: 'round_robin', provider: 'mock' }}
      >
        <Card title="① 评审材料（必填）">
          <Form.Item
            name="title"
            label="评审标题"
            rules={[{ required: true, message: '请输入评审标题' }]}
          >
            <Input placeholder="例如：订单中心微服务重构方案评审" size="large" />
          </Form.Item>

          <Form.Item
            name="objective"
            label="评审目标"
            rules={[{ required: true, message: '请输入评审目标' }]}
            extra="一句话概括本次评审必须回答的核心问题"
          >
            <Input.TextArea
              rows={2}
              placeholder="例如：验证新架构在高并发（10k QPS）下的可用性、资源成本与交付风险"
            />
          </Form.Item>

          <Form.Item
            name="content"
            label={
              <span>
                评审材料 / 方案全文 <span style={{ color: '#94a3b8', fontWeight: 400 }}>（可选，支持 Markdown，最多 20000 字）</span>
              </span>
            }
            extra="方案正文将作为上下文注入各位专家的 Prompt，直接决定评审深度；材料越完整，报告越精准。"
          >
            <Input.TextArea
              rows={10}
              maxLength={MAX_CONTENT_CHARS}
              showCount
              placeholder={`在此粘贴方案全文（设计文档、架构图说明、需求描述等）。\n\n支持 Markdown 格式。`}
            />
          </Form.Item>
        </Card>

        <Card title="② 评审模式">
          <Form.Item name="mode" label="Workflow 预设">
            <Select
              placeholder="选择评审流程预设"
              options={workflows.map((w) => ({
                value: w.id,
                label: (
                  <Space direction="vertical" size={0}>
                    <span>{w.name}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>{w.description}</span>
                  </Space>
                ),
              }))}
              optionFilterProp="children"
            />
          </Form.Item>
        </Card>

        <Card
          title="③ AI 模型（可选）"
          extra={<Tag color={provider === 'mock' ? 'default' : 'blue'}>{PROVIDERS.find((p) => p.value === provider)?.label}</Tag>}
        >
          <Form.Item label="选择 Provider">
            <Radio.Group
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              options={PROVIDERS.map((p) => {
                const available = availProviders[p.value];
                return {
                  value: p.value,
                  label: (
                    <Space direction="vertical" size={2}>
                      <span>{p.label}</span>
                      <span style={{ color: available ? '#555' : '#f59e0b', fontSize: 12 }}>{p.desc}</span>
                    </Space>
                  ),
                  disabled: !available,
                };
              })}
            />
          </Form.Item>

          {provider !== 'mock' && (
            <>
              {!availProviders[provider] && (
                <Alert
                  type="warning"
                  showIcon
                  message={`当前 API 未配置 ${provider} provider`}
                  description={`${provider} 未在 API 启动时启用。切换回 Mock 或在 API 环境变量中启用 ${provider}。`}
                />
              )}
              {meta.showModel && (
                <Form.Item name="model" label="模型名称" initialValue={meta.defaultModel}>
                  <Input placeholder={meta.defaultModel} />
                </Form.Item>
              )}
              {meta.showBaseUrl && (
                <Form.Item name="baseUrl" label="Base URL" initialValue={meta.defaultBaseUrl}>
                  <Input placeholder={meta.defaultBaseUrl} />
                </Form.Item>
              )}
              {meta.showKey && (
                <Form.Item
                  name="apiKey"
                  label={<>API Key {meta.keyRequired && <span style={{ color: '#ef4444' }}>*</span>}</>}
                  rules={meta.keyRequired ? [{ required: true, message: '需要 API Key 才能调用云端模型' }] : undefined}
                >
                  <Input.Password placeholder="sk-..." autoComplete="new-password" />
                </Form.Item>
              )}
              <Divider style={{ margin: '12px 0' }} />
              <Alert
                type="info"
                showIcon
                message="真实 LLM 模式说明"
                description="开启后将调用真实模型进行多轮辩论与 Moderator 决策，计入对应 provider 的 token 消耗（默认受 BUDGET 硬闸兜底）。失败会自动降级 Mock，不影响主流程。"
              />
            </>
          )}
        </Card>

        <Card title="③ 评审语言">
          <Form.Item label="专家回复语言">
            <Radio.Group
              defaultValue="auto"
              onChange={(e) => setLangMode(e.target.value)}
              options={[
                { value: 'auto', label: '自动检测（根据评审内容判断中英文）' },
                { value: 'zh', label: '强制中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Form.Item>
        </Card>

        <Form.Item style={{ marginTop: 8 }}>
          <Space>
            <Button onClick={() => router.push('/reviews')}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading} size="large">
              进入诊断
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Space>
  );
}
