'use client';
import React, { useState } from 'react';
import { Modal, Steps, Form, Input, Select, Button, Space, Typography, message, Alert, Spin, Tag, App } from 'antd';
import { useProviderStore } from '../../lib/stores/providerStore';

const { Text, Title, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRESETS = [
  { label: 'LongCat-2.0 (云端)', provider: 'openai_compatible', model: 'LongCat-2.0', baseUrl: 'https://api.longcat.chat/openai/v1', needKey: true },
  { label: 'OpenAI', provider: 'openai_compatible', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', needKey: true },
  { label: 'LM Studio (本地)', provider: 'lmstudio', model: 'google/gemma-4-12b', baseUrl: 'http://127.0.0.1:1234/v1', needKey: false },
  { label: 'Mock (零成本演示)', provider: 'mock', model: 'mock', baseUrl: 'http://localhost', needKey: false },
];

export default function SetupWizard({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [presetIdx, setPresetIdx] = useState(0);
  const [form] = Form.useForm<{ name: string; apiKey: string; baseUrl: string; model: string; provider: string; }>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; latencyMs: number; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { create } = useProviderStore();
  const { modal } = App.useApp();

  const preset = PRESETS[presetIdx];

  const handleTest = async () => {
    const v = form.getFieldsValue();
    setTesting(true);
    setTestResult(null);
    try {
      // Temporär einen Provider zum Testen anlegen (ohne zu aktivieren)
      await create({
        name: `__test_${Date.now()}`,
        provider: v.provider,
        model: v.model,
        baseUrl: v.baseUrl,
        apiKey: v.apiKey,
      });
      // Den neu erstellten Provider finden (letzter in der Liste)
      const providers = useProviderStore.getState().providers;
      const tmp = providers.find((p) => p.name.startsWith('__test_'));
      if (!tmp) throw new Error('Test-Provider konnte nicht erstellt werden');
      const res = await useProviderStore.getState().test(tmp.id);
      setTestResult(res);
      // Test-Provider wieder löschen
      await useProviderStore.getState().remove(tmp.id);
    } catch (e: any) {
      setTestResult({ status: 'unreachable', latencyMs: 0, message: e.message ?? '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleFinish = async () => {
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      await create({
        name: v.name || preset.label,
        provider: v.provider,
        model: v.model,
        baseUrl: v.baseUrl,
        apiKey: v.apiKey,
        activate: true,
      });
      message.success('Provider 已配置并激活');
      onClose();
    } catch (e: any) {
      message.error(e.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<span>🚀 首次配置 · LLM Provider</span>}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Steps current={step} size="small" items={[
        { title: '选择 Provider' },
        { title: '填写配置' },
        { title: '测试连接' },
      ]} style={{ marginBottom: 24 }} />

      {step === 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Paragraph type="secondary">选择你的 AI 模型 Provider。可以随时在「管理」页面添加更多。</Paragraph>
          <Select
            value={presetIdx}
            onChange={(i) => {
              setPresetIdx(i);
              const p = PRESETS[i];
              form.setFieldsValue({ provider: p.provider, model: p.model, baseUrl: p.baseUrl });
            }}
            options={PRESETS.map((p, i) => ({ value: i, label: p.label }))}
            style={{ width: '100%' }}
          />
          {preset.needKey && <Alert type="info" showIcon message="此 Provider 需要 API Key" />}
        </Space>
      )}

      {step === 1 && (
        <Form form={form} layout="vertical" initialValues={{ provider: preset.provider, model: preset.model, baseUrl: preset.baseUrl }}>
          <Form.Item name="name" label="显示名称">
            <Input placeholder={preset.label} />
          </Form.Item>
          <Form.Item name="provider" hidden><Input /></Form.Item>
          <Form.Item name="model" label="模型名称" rules={[{ required: true }]}>
            <Input placeholder="LongCat-2.0" />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
            <Input placeholder="https://api.longcat.chat/openai/v1" />
          </Form.Item>
          {preset.needKey && (
            <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
              <Input.Password placeholder="sk-..." autoComplete="new-password" />
            </Form.Item>
          )}
        </Form>
      )}

      {step === 2 && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Paragraph type="secondary">测试连接，确保配置正确。</Paragraph>
          <Button onClick={handleTest} loading={testing} block>测试连接</Button>
          {testResult && (
            <Alert
              type={testResult.status === 'ready' ? 'success' : 'error'}
              showIcon
              message={testResult.status === 'ready' ? '连接成功' : '连接失败'}
              description={<Space direction="vertical" size={0}>
                <Text>{testResult.message}</Text>
                <Text type="secondary">延迟: {testResult.latencyMs}ms</Text>
              </Space>}
            />
          )}
        </Space>
      )}

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>上一步</Button>
        <Space>
          <Button onClick={onClose}>稍后配置</Button>
          {step < 2 && <Button type="primary" onClick={() => setStep((s) => s + 1)}>下一步</Button>}
          {step === 2 && <Button type="primary" onClick={handleFinish} loading={saving} disabled={!testResult || testResult.status !== 'ready'}>完成并激活</Button>}
        </Space>
      </div>
    </Modal>
  );
}
