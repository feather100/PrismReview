'use client';
import React, { useState, useCallback, useMemo } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ThemeConfig } from 'antd';
import { lightTheme, darkTheme } from '../styles/theme';
import AppLayout from '../components/layout/AppLayout';

export const metadata = {
  title: 'PrismReview — 多 Agent 智能评审中枢',
  description:
    'PrismReview 多 Agent 智能评审中枢：让一群专家为你的方案多轮辩论，由 AI Moderator 收敛出一份可量化、可溯源、可审计的正式评审报告。',
};

type Mode = 'light' | 'dark';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');

  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);

  const theme: ThemeConfig = useMemo(
    () => (mode === 'dark' ? darkTheme : lightTheme),
    [mode],
  );

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body style={{ margin: 0, fontFamily: lightTheme.token?.fontFamily as string }}>
        <AntdRegistry>
          <ConfigProvider theme={theme} locale={zhCN}>
            <AppLayout onThemeChange={toggle} themeMode={mode}>
              {children}
            </AppLayout>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
