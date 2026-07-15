'use client';
import React, { useState, useCallback, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ThemeConfig } from 'antd';
import { lightTheme, darkTheme } from '../styles/theme';
import AppLayout from '../components/layout/AppLayout';

type Mode = 'light' | 'dark';

/** Client-only root. Owns theme-mode state so the root layout.tsx (which
 *  exports `metadata` and therefore must stay a Server Component) can be clean.
 */
export default function RootClient({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');
  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);
  const theme: ThemeConfig = useMemo(() => (mode === 'dark' ? darkTheme : lightTheme), [mode]);

  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <AppLayout onThemeChange={toggle} themeMode={mode}>
        {children}
      </AppLayout>
    </ConfigProvider>
  );
}
