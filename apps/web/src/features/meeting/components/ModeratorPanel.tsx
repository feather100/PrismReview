'use client';
import React, { useEffect, useState } from 'react';
import { Card, Tag, Space, Typography, List, Spin } from 'antd';
import { CrownOutlined, CheckCircleOutlined, ArrowUpOutlined, StopOutlined, GlobalOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface ModeratorDecision {
  id: string;
  round: number;
  decisionType: string;
  reasoning: string;
  ruleCheckResult?: any;
  createdAt: string;
}

const TYPE_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  converge: { color: 'green', icon: <CheckCircleOutlined />, label: '收敛 → 完成' },
  force_stop: { color: 'red', icon: <StopOutlined />, label: '强制中止' },
  advance_round: { color: 'blue', icon: <ArrowUpOutlined />, label: '推进下一轮' },
  continue_debate: { color: 'orange', icon: <ArrowUpOutlined />, label: '继续辩论' },
  propose_tool: { color: 'purple', icon: <GlobalOutlined />, label: '工具调用建议' },
};

export default function ModeratorPanel({ reviewId, refreshKey }: { reviewId: string; refreshKey: number }) {
  const [decisions, setDecisions] = useState<ModeratorDecision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews-defense/${reviewId}/state`, {
          headers: { Authorization: 'Bearer test-token' },
        });
        if (res.ok && !cancelled) {
          const st = await res.json();
          setDecisions(st.lastDecision ? [{ ...st.lastDecision, id: `${reviewId}-${st.round}`, createdAt: new Date().toISOString() }] : []);
        }
      } catch { /* ignore */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reviewId, refreshKey]);

  if (loading) return <Spin size="small" />;
  if (!decisions.length) return <Text type="secondary">等待第一轮汇总...</Text>;

  return (
    <List
      size="small"
      dataSource={decisions}
      renderItem={(d) => {
        const meta = TYPE_META[d.decisionType] ?? { color: 'default', icon: null, label: d.decisionType };
        return (
          <List.Item>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Space>
                <Tag color={meta.color} icon={meta.icon}>Round {d.round}: {meta.label}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleTimeString('zh-CN')}</Text>
              </Space>
              {d.reasoning && <Text style={{ fontSize: 13 }}>{d.reasoning}</Text>}
            </Space>
          </List.Item>
        );
      }}
    />
  );
}
