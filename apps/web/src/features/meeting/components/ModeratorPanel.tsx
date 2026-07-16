'use client';
import React, { useEffect, useState } from 'react';
import { Card, Tag, Space, Typography, List, Spin } from 'antd';
import { CrownOutlined, CheckCircleOutlined, ArrowUpOutlined, StopOutlined, GlobalOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface StateResponse {
  reviewId: string;
  status: string;
  round: number;
  defenseCount: number;
  mentionExpertCode?: string;
  mentionDirection?: string;
  lastDecision?: { round: number; decisionType: string; reasoning: string };
  awaitingUserDefense: boolean;
  totalTurns: number;
  completedTurns: number;
}

const TYPE_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  converge: { color: 'green', icon: <CheckCircleOutlined />, label: 'Moderator: concurrence → clôturé' },
  force_stop: { color: 'red', icon: <StopOutlined />, label: 'Moderator: clôture forcée' },
  advance_round: { color: 'blue', icon: <ArrowUpOutlined />, label: 'Moderator: passer au round suivant' },
  continue_debate: { color: 'orange', icon: <ArrowUpOutlined />, label: 'Moderator: débat continu (round +1)' },
  propose_tool: { color: 'purple', icon: <GlobalOutlined />, label: 'Moderator: appel outil externe' },
  ask_user_defense: { color: 'gold', icon: <CrownOutlined />, label: 'Moderator: attend votre réplique/défense' },
};

export default function ModeratorPanel({ reviewId, refreshKey }: { reviewId: string; refreshKey: number }) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews-defense/${reviewId}/state`, {
          headers: { Authorization: 'Bearer test-token' },
        });
        if (res.ok && !cancelled) setState(await res.json());
      } catch { /* ignore */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reviewId, refreshKey]);

  if (loading) return <Spin size="small" />;
  if (!state) return <Text type="secondary">Chargement...</Text>;

  const totalTurns = state.totalTurns ?? 0;
  const completedTurns = state.completedTurns ?? 0;

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {/* 问题 4: progression par tour d'experts */}
      <Card size="small">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Round {state.round} — {completedTurns}/{totalTurns} experts have spoken
          </Text>
          <div style={{ width: '100%', height: 6, background: '#f0f0f0', borderRadius: 3 }}>
            <div style={{
              width: `${totalTurns > 0 ? (completedTurns / totalTurns) * 100 : 0}%`,
              height: '100%', background: '#6366f1', borderRadius: 3,
            }} />
          </div>
        </Space>
      </Card>

      {/* 问题 6: indication专家 mention + défense requise */}
      {state.mentionExpertCode && (
        <Card size="small" style={{ borderColor: '#6366f1' }}>
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12, color: '#6366f1' }}>👤 Expert mentionné: <Tag>{state.mentionExpertCode}</Tag></Text>
            {state.mentionDirection && <Text type="secondary" style={{ fontSize: 12 }}>Direction: {state.mentionDirection}</Text>}
          </Space>
        </Card>
      )}

      {/* 问题 3+6: decision du Moderator */}
      {state.lastDecision ? (
        <List
          size="small"
          dataSource={[state.lastDecision].filter(Boolean)}
          renderItem={(d) => {
            const meta = TYPE_META[d.decisionType] ?? { color: 'default', icon: null, label: d.decisionType };
            return (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space>
                    <Tag color={meta.color} icon={meta.icon}>{meta.label}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>Round {d.round}</Text>
                  </Space>
                  <Text style={{ fontSize: 13 }}>{d.reasoning}</Text>
                </Space>
              </List.Item>
            );
          }}
        />
      ) : (
        <Text type="secondary">
          {state.status === 'running' ? `ecoute des experts (${completedTurns}/${totalTurns} tours terminés)...`
            : state.status === 'summarized' ? 'Moderator analyse les avis...'
            : 'Attend le premier round...'}
        </Text>
      )}

      {state.awaitingUserDefense && (
        <Card size="small" style={{ borderColor: '#f59e0b', background: '#fffbe6' }}>
          <Text style={{ fontSize: 13 }}>
            🛎 Le Moderator attend votre <Text strong>défense / complément d'information</Text> avant de clôturer.
            Saisissez-la dans le champ « Réplique utilisateur » à gauche.
          </Text>
        </Card>
      )}
    </Space>
  );
}
