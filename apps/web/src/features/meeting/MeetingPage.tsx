'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { Alert, Spin, Tag, Tooltip, Button, Space, Modal, Form, Input, Select, message, Divider, Card } from 'antd';
import MeetingHeader from './components/MeetingHeader';
import AgentPanel, { AgentStatus } from './components/AgentPanel';
import SpeechFlow from './components/SpeechFlow';
import ContextPanel from './components/ContextPanel';
import { SpeechCardData } from './components/SpeechCard';
import ModeratorPanel from './components/ModeratorPanel';
import { useMeetingSSE, MeetingEventPayload } from '../../lib/realtime/useMeetingSSE';
import { apiClient } from '../../lib/api-client/client';
import { useRouter } from 'next/navigation';

export default function MeetingPage({ reviewId }: { reviewId: string }) {
  const [meetingStatus, setMeetingStatus] = useState<'connecting' | 'running' | 'completed' | 'error'>('connecting');
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [cards, setCards] = useState<SpeechCardData[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [moderatorRefresh, setModeratorRefresh] = useState(0);
  const router = useRouter();
  const [hitlOpen, setHitlOpen] = useState(false);
  const [hitlBusy, setHitlBusy] = useState(false);
  const [humanForm] = Form.useForm<{ roleCode: string; dimension: string; issue: string; recommendation: string; riskLevel: string }>();

  const handleInterrupt = async () => {
    setHitlBusy(true);
    try {
      await apiClient.interruptReview(reviewId);
      message.success('已请求中断评审（HITL pause）');
    } catch (e: any) {
      message.error(e.message ?? '中断请求失败');
    } finally { setHitlBusy(false); }
  };
  const handleResume = async () => {
    setHitlBusy(true);
    try {
      await apiClient.resumeReview(reviewId);
      message.success('已恢复评审');
    } catch (e: any) {
      message.error(e.message ?? '恢复请求失败');
    } finally { setHitlBusy(false); }
  };
  const handleHumanTurn = async () => {
    setHitlBusy(true);
    try {
      const v = await humanForm.validateFields();
      await apiClient.submitHumanTurn(reviewId, v);
      message.success('人工意见已注入（source=human）');
      setHitlOpen(false);
      humanForm.resetFields();
    } catch (e: any) {
      message.error(e.message ?? '提交失败');
    } finally { setHitlBusy(false); }
  };

  const handleSSEEvent = useCallback((type: string, data: MeetingEventPayload) => {
    switch(type) {
      case 'meeting.started':
        setMeetingStatus('running');
        // Pre-populate agents if provided, else rely on turn starts
        break;

      case 'agent.turn.started':
        setAgents(prev => {
          const exists = prev.find(a => a.roleCode === data.roleCode);
          if (exists) {
            return prev.map(a => a.roleCode === data.roleCode ? { ...a, status: 'speaking' } : a);
          }
          return [...prev, { roleId: data.roleId || data.roleCode || '', roleCode: data.roleCode || '', roleName: data.roleName || '', status: 'speaking', speechCount: 0 }];
        });
        
        setCards(prev => [...prev, {
          id: data.turnId || Date.now().toString(),
          turnId: data.turnId || '',
          agentCode: data.roleCode || '',
          agentName: data.roleName || '',
          dimension: data.dimension || 'General',
          riskLevel: 'pending',
          content: '',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        break;

      case 'agent.message.delta':
        setCards(prev => prev.map(c => 
          c.turnId === data.turnId ? { ...c, content: c.content + data.delta } : c
        ));
        break;

      case 'agent.message.completed':
        setCards(prev => prev.map(c => 
          c.turnId === data.turnId ? { 
            ...c, 
            content: data.content || c.content, 
            riskLevel: data.riskLevel || 'info',
            dimension: data.dimension || c.dimension,
          } : c
        ));
        break;

      case 'agent.turn.completed':
        setAgents(prev => prev.map(a => 
          a.roleCode === data.roleCode ? { ...a, status: 'done', speechCount: a.speechCount + 1 } : a
        ));
        setCompletedTurns(prev => prev + 1);
        break;

      case 'meeting.completed':
        setMeetingStatus('completed');
        // Force all agents to done just in case
        setAgents(prev => prev.map(a => ({ ...a, status: 'done' })));
        break;

      case 'error':
        setBackendError(data.message || (typeof data === 'string' ? data : '会议流连接异常，请稍后重试。'));
        // Do not change meetingStatus to 'error' to avoid blank screens/loss of current progress, just show the banner
        break;
    }
  }, []);

  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  
  useEffect(() => {
    apiClient.getReview(reviewId)
      .then((res: any) => {
        setReviewStatus(res.status);
        setInitialLoading(false);
      })
      .catch((err: any) => {
        setBackendError(err.message || '获取评审详情失败。');
        setInitialLoading(false);
      });
  }, [reviewId]);

  const isSSEEnabled = reviewStatus === 'running' || reviewStatus === 'interrupted' || reviewStatus === 'summarized' || reviewStatus === 'completed';
  const { connectionStatus } = useMeetingSSE(reviewId, handleSSEEvent, isSSEEnabled);

  // 刷新 Moderator 面板 / 状态探测 toutes les 2s pendant le meeting
  useEffect(() => {
    if (reviewStatus === 'completed') return;
    const t = setInterval(() => {
      setModeratorRefresh((n) => n + 1);
    }, 2000);
    return () => clearInterval(t);
  }, [reviewStatus]);

  if (initialLoading) {
    return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin tip="加载中..." /></div>;
  }

  if (reviewStatus === 'created' || reviewStatus === 'diagnosed') {
    return (
      <div style={{ padding: 48 }}>
        <Alert
          message="无法进入会议室"
          description="该评审尚未开始，请先完成诊断并确认评审团。"
          type="warning"
          showIcon
          action={<Button type="primary" onClick={() => router.push(`/reviews/${reviewId}`)}>返回诊断页</Button>}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* 错误与断线 UI */}
      {backendError && (
        <Alert message="会议异常" description={backendError} type="error" showIcon style={{ marginBottom: 16 }} />
      )}
      {connectionStatus === 'disconnected' && meetingStatus !== 'completed' && (
        <Alert message="已断开" description="与会议室流的连接已丢失。正在等待重连..." type="warning" showIcon style={{ marginBottom: 16 }} />
      )}
      {connectionStatus === 'error' && meetingStatus !== 'completed' && (
        <Alert message="连接异常" description="无法连接到会议流服务器。" type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      <MeetingHeader
        title={`架构评审室: ${reviewId}`}
        status={meetingStatus === 'connecting' ? 'running' : meetingStatus === 'error' ? 'running' : meetingStatus}
        completedTurns={completedTurns}
        totalTurns={agents.length > 0 ? Math.max(agents.length, completedTurns) : 0}
        onViewReport={() => router.push(`/reviews/${reviewId}/report`)}
      />

      {/* ── HITL control bar ── */}
      {(reviewStatus === 'running' || reviewStatus === 'interrupted' || reviewStatus === 'summarized') && (
        <div style={{ marginTop: 12, marginBottom: 8 }}>
          <Space wrap>
            {reviewStatus !== 'interrupted' ? (
              <Tooltip title="暂停评审会（进入 HITL 状态，可注入人工意见）">
                <Button danger loading={hitlBusy} onClick={handleInterrupt}>⚡ 中断（HITL pause）</Button>
              </Tooltip>
            ) : (
              <Tooltip title="从 HITL 暂停中恢复评审会">
                <Button type="primary" loading={hitlBusy} onClick={handleResume}>▶ 恢复评审</Button>
              </Tooltip>
            )}
            <Tooltip title="以人类评审员身份注入一条意见（source=human）">
              <Button onClick={() => setHitlOpen(true)} disabled={hitlBusy}>✍ 人工意见</Button>
            </Tooltip>
          </Space>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Column: Agent Panel (20%) */}
        <div style={{ width: '20%', paddingRight: 8 }}>
          {connectionStatus === 'connecting' ? (
            <div style={{ textAlign: 'center', marginTop: 50 }}><Spin tip="正在连接会议..." /></div>
          ) : (
            <AgentPanel agents={agents} />
          )}
        </div>
        
        {/* Center Column: Speech Flow (55%) */}
        <div style={{ width: '55%', borderLeft: '1px solid #f0f0f0', borderRight: '1px solid #f0f0f0' }}>
          <SpeechFlow cards={cards} />
        </div>
        
        {/* Right Column: Modérateur (25%) */}
        <div style={{ width: '25%', paddingLeft: 8 }}>
          <Card title="👑 Modérateur" size="small" styles={{ body: { maxHeight: 280, overflow: 'auto' } }}>
            <ModeratorPanel reviewId={reviewId} refreshKey={moderatorRefresh} />
          </Card>
        </div>
      </div>

      {/* ── Human-turn modal ── */}
      <Modal
        title="人工评审意见"
        open={hitlOpen}
        onCancel={() => { setHitlOpen(false); humanForm.resetFields(); }}
        onOk={handleHumanTurn}
        confirmLoading={hitlBusy}
        okText="提交（source=human）"
        width={560}
      >
        <Form form={humanForm} layout="vertical" initialValues={{ riskLevel: 'medium' }}>
          <Form.Item name="roleCode" label="视角 / 角色" rules={[{ required: true, message: '请选择角色视角' }]}>
            <Select
              options={[
                { value: 'CTO', label: 'CTO · 技术审核员' },
                { value: 'CFO', label: 'CFO · 商业控制者' },
                { value: 'PMO', label: 'PMO · 交付守护者' },
                { value: 'Compliance', label: 'Compliance · 合规审查员' },
                { value: 'UserAdvocate', label: 'UserAdvocate · 用户代言人' },
                { value: 'Human', label: '评审员（通用）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="dimension" label="维度">
            <Input placeholder="例：架构合理性 / 成本 / 合规" />
          </Form.Item>
          <Form.Item name="issue" label="问题" rules={[{ required: true, message: '请描述问题' }]}>
            <Input.TextArea rows={2} placeholder="人工评审意见 — 发现的问题" />
          </Form.Item>
          <Form.Item name="recommendation" label="建议">
            <Input.TextArea rows={2} placeholder="修改/处理建议" />
          </Form.Item>
          <Form.Item name="riskLevel" label="风险等级">
            <Select options={[
              { value: 'high', label: '🔴 high' },
              { value: 'medium', label: '🟠 medium' },
              { value: 'low', label: '🔵 low' },
              { value: 'info', label: '⚪ info' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
