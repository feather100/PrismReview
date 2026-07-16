import React from 'react';
import { Tag, Button, Progress, Space } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, StopOutlined } from '@ant-design/icons';

interface Props {
  title: string;
  status: string;
  round: number;
  totalExperts: number;
  completedTurns: number;
  onViewReport?: () => void;
}

export default function MeetingHeader({ title, status, round, totalExperts, completedTurns, onViewReport }: Props) {
  let tagColor = 'processing';
  let displayStatus = status.toUpperCase();
  if (status === 'completed') { tagColor = 'success'; displayStatus = '已完成'; }
  else if (status === 'interrupted') { tagColor = 'warning'; displayStatus = '已中断(HITL)'; }
  else if (status === 'running') { tagColor = 'processing'; displayStatus = `评审中 (第 ${round} 轮)`; }
  else if (status === 'summarized') { tagColor = 'blue'; displayStatus = 'Moderator 已汇总'; }
  else if (status === 'pending_defense') { tagColor = 'orange'; displayStatus = '等待用户申辩'; }
  else if (status === 'created') { tagColor = 'default'; displayStatus = '已创建'; }
  else if (status === 'diagnosed') { tagColor = 'cyan'; displayStatus = '已诊断'; }
  else if (status === 'failed') { tagColor = 'error'; displayStatus = '失败'; }
  else if (status === 'aborted') { tagColor = 'volcano'; displayStatus = '已中止'; }
  else if (status === 'archived') { tagColor = 'default'; displayStatus = '已归档'; }
  else if (status === 'error' || status === 'disconnected') { tagColor = 'error'; displayStatus = '连接异常'; }

  // 进度 = tours d'experts terminés dans le round courant (problème 4)
  const percent = totalExperts > 0 ? Math.round((completedTurns / totalExperts) * 100) : 0;

  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '16px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size="large">
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
            <Tag color={tagColor} style={{ marginTop: 4 }}>{displayStatus}</Tag>
          </div>
          <div style={{ width: 200, marginLeft: 24 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
              第 {round} 轮 — 已发言 {completedTurns} / {totalExperts} 位专家
            </div>
            <Progress percent={percent} size="small" />
          </div>
        </Space>
        <Space>
          {status === 'completed' && onViewReport && (
            <Button type="primary" onClick={onViewReport}>查看评审报告</Button>
          )}
        </Space>
      </div>
    </div>
  );
}
