import type { ThemeConfig } from 'antd';

// ── Brand ────────────────────────────────────────────────────────────────────
// PrismReview brand palette. Keep these in sync with the SVG logo / README banner.
const brand = {
  indigo: '#6366f1',
  indigoSoft: '#eef2ff',
  ink: '#0f172a',
  inkMuted: '#475569',
};

// ── Light theme (default) ────────────────────────────────────────────────────
export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.indigo,
    colorInfo: brand.indigo,
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    borderRadius: 8,
    fontFamily:
      'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    fontSize: 14,
  },
  components: {
    Layout: {
      bodyBg: '#f8fafc',
      headerBg: '#ffffff',
      siderBg: '#ffffff',
    },
    Card: {
      boxShadow:
        '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
    },
    Menu: {
      itemBorderRadius: 6,
      subMenuItemBorderRadius: 6,
    },
  },
};

// ── Dark theme ───────────────────────────────────────────────────────────────
// Toggled at runtime via ConfigProvider. Applied in layout.tsx.
export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: '#818cf8',
    colorInfo: '#818cf8',
    colorSuccess: '#34d399',
    colorWarning: '#fbbf24',
    colorError: '#f87171',
    borderRadius: 8,
    fontFamily:
      'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    colorBgContainer: '#1e293b',
    colorBgElevated: '#1e293b',
    colorBgLayout: '#0f172a',
    colorBorder: '#334155',
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
  },
  components: {
    Layout: {
      bodyBg: '#0f172a',
      headerBg: '#1e293b',
      siderBg: '#1e293b',
    },
    Card: {
      boxShadow: 'none',
    },
  },
};

export const defaultTheme = lightTheme;
export { brand };
