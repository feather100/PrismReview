'use client';
import React, { useState } from 'react';
import { Typography, Form, Input, Button, Card, Select, message, Space } from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient, CreateReviewInput } from '../../../lib/api-client/client';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export default function NewReviewPage() {
  const [form] = Form.useForm<CreateReviewInput>();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleFinish = async (values: CreateReviewInput) => {
    setLoading(true);
    try {
      const review = await apiClient.createReview({
        title: values.title,
        objective: values.objective,
        content: values.content,
        mode: values.mode || 'round_robin',
      });
      message.success('评审已创建，正在进入诊断页。');
      // Navigate to diagnosis or reviews depending on user choice, but for now we provide options in a modal, or just route to diagnosis page
      router.push(`/reviews/${review.id}`);
    } catch (err: any) {
      message.error(err.message || '创建评审失败。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>新建架构评审</Title>
        <Button onClick={() => router.push('/reviews')}>返回我的评审</Button>
      </div>

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          initialValues={{ mode: 'round_robin' }}
        >
          <Form.Item
            name="title"
            label="评审标题"
            rules={[{ required: true, message: '请输入评审标题' }]}
          >
            <Input placeholder="例如: 订单中心微服务重构方案评审" size="large" />
          </Form.Item>

          <Form.Item
            name="objective"
            label="评审目标"
            rules={[{ required: true, message: '请输入评审目标' }]}
            extra="一句话概括本次评审希望解决的核心问题或达成的目标"
          >
            <Input placeholder="例如: 验证新架构在高并发场景下的可用性和资源成本" />
          </Form.Item>

          <Form.Item
            name="mode"
            label="评审模式"
            extra="当前支持轮询发言 (Round Robin) 或自由辩论 (Free Debate)"
          >
            <Select>
              <Option value="round_robin">轮询发言 (Round Robin)</Option>
              <Option value="free_debate">自由辩论 (Free Debate)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="content"
            label="评审材料 (内容)"
            extra={
              <>
                将设计文档、架构图或背景资料的文本直接粘贴至此。
                <br />
                <span style={{ color: '#faad14' }}>当前支持文本/Markdown 粘贴，附件上传暂未接入。</span>
              </>
            }
          >
            <TextArea rows={12} placeholder="在此处粘贴您的方案内容..." />
          </Form.Item>

          <Form.Item style={{ marginTop: 32, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => router.push('/reviews')}>取消</Button>
              <Button type="primary" htmlType="submit" loading={loading} size="large">
                提交评审
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
