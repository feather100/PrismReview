import React from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { defaultTheme } from '../styles/theme';
import RootClient from './RootClient';

export const metadata = {
  title: 'PrismReview — 多 Agent 智能评审中枢',
  description:
    'PrismReview 多 Agent 智能评审中枢：让一群专家为你的方案多轮辩论，由 AI Moderator 收敛出一份可量化、可溯源、可审计的正式评审报告。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body style={{ margin: 0, fontFamily: defaultTheme.token?.fontFamily as string }}>
        <AntdRegistry>
          {/* Client-side wrapper handles theme toggle state. */}
          <RootClient>{children}</RootClient>
        </AntdRegistry>
      </body>
    </html>
  );
}
