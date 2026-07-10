'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { Alert, Spin, Tag, Tooltip, Button } from 'antd';
import MeetingHeader from './components/MeetingHeader';
import AgentPanel, { AgentStatus } from './components/AgentPanel';
import SpeechFlow from './components/SpeechFlow';
import ContextPanel from './components/ContextPanel';
import { SpeechCardData } from './components/SpeechCard';
import { useMeetingSSE, MeetingEventPayload } from '../../lib/realtime/useMeetingSSE';
import { apiClient } from '../../lib/api-client/client';
import { useRouter } from 'next/navigation';

export default function MeetingPage({ reviewId }: { reviewId: string }) {
  const [meetingStatus, setMeetingStatus] = useState<'connecting' | 'running' | 'completed' | 'error'>('connecting');
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [cards, setCards] = useState<SpeechCardData[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const router = useRouter();

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

  const isSSEEnabled = reviewStatus === 'running' || reviewStatus === 'interrupted' || reviewStatus === 'summarizing' || reviewStatus === 'completed';
  const { connectionStatus } = useMeetingSSE(reviewId, handleSSEEvent, isSSEEnabled);

  if (initialLoading) {
    return <div style={{ textAlign: 'center', marginTop: 100 }}><Spin tip="加载中..." /></div>;
  }

  if (reviewStatus === 'draft' || reviewStatus === 'ready') {
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
        totalTurns={agents.length > 0 ? Math.max(agents.length, completedTurns) : 0} // Approximation
        onViewReport={() => router.push(`/reviews/${reviewId}/report`)}
      />
      
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', marginTop: 16 }}>
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
        
        {/* Right Column: Context Panel (25%) */}
        <div style={{ width: '25%', paddingLeft: 8 }}>
          <ContextPanel summary="使用 Go 微服务重构订单系统，替代遗留的 PHP 单体架构..." />
        </div>
      </div>
    </div>
  );
}
