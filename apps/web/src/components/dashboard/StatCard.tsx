import React from 'react';
import { Card, Typography, Space } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

interface Props {
  title: string;
  value: ReactNode;
  suffix?: string;
  icon?: ReactNode;
  accent?: string; // tail color strip
  onClick?: () => void;
  loading?: boolean;
}

export default function StatCard({ title, value, suffix, icon, accent = '#6366f1', onClick, loading }: Props) {
  return (
    <Card
      hoverable={!!onClick}
      onClick={onClick}
      style={{ borderRadius: 12, overflow: 'hidden' }}
      styles={{ body: { padding: '20px 24px' } }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: 4,
          background: accent,
          borderRadius: '12px 0 0 12px',
        }}
        aria-hidden
      />
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space>
          <span style={{ color: '#64748b', fontSize: 13 }}>{title}</span>
          {icon && <span style={{ color: accent }}>{icon}</span>}
        </Space>
        <Space align="baseline" size={4}>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
            {loading ? '—' : value}
          </span>
          {suffix && <Text type="secondary">{suffix}</Text>}
        </Space>
      </Space>
    </Card>
  );
}
