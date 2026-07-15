'use client';
import React, { useState, useMemo } from 'react';
import { Layout, Menu, Typography, Avatar, Space, Badge, Tooltip, Button } from 'antd';
import { useRouter, usePathname } from 'next/navigation';
import {
  DashboardOutlined,
  AuditOutlined,
  AppstoreOutlined,
  TeamOutlined,
  BookOutlined,
  FileSearchOutlined,
  SettingOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  badge?: string; // "new" pill
}

const NAV: NavItem[] = [
  { key: '/', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/reviews', icon: <FileSearchOutlined />, label: '评审中心' },
  { key: '/roles', icon: <TeamOutlined />, label: '评审团' },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
  { key: '/prompts', icon: <AppstoreOutlined />, label: 'Prompt 模板' },
  { key: '/knowledge', icon: <BookOutlined />, label: '知识库', badge: 'WIP' },
  { key: '/workflows', icon: <BulbOutlined />, label: 'Workflow' },
];

const CURRENT_USER = {
  name: 'Mock User',
  role: 'enterprise_admin',
  email: 'mock@prismreview.dev',
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员',
  enterprise_admin: '企业管理员',
  department_admin: '部门管理员',
  user: '评审员',
};

const Crumb: Record<string, string> = {
  '/': '工作台',
  '/reviews': '评审列表',
  '/reviews/new': '新建评审',
  '/roles': '评审团',
  '/audit': '审计日志',
  '/prompts': 'Prompt 模板',
  '/knowledge': '知识库',
  '/workflows': 'Workflow 预设',
};

export default function AppLayout({
  children,
  onThemeChange,
  themeMode,
}: {
  children: React.ReactNode;
  onThemeChange?: () => void;
  themeMode?: 'light' | 'dark';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = useMemo(
    () => NAV.find((n) => n.key !== '/' && pathname.startsWith(n.key))?.key ?? '/',
    [pathname],
  );

  const breadcrumbs = useMemo(() => {
    // Exact match first, then longest prefix match.
    if (Crumb[pathname]) return [Crumb[pathname]];
    const segments = pathname.split('/').filter(Boolean);
    const crumbs: string[] = [];
    let acc = '';
    for (const s of segments) {
      acc += `/${s}`;
      if (Crumb[acc]) crumbs.push(Crumb[acc]);
      else crumbs.push(s);
    }
    return crumbs.length ? crumbs : ['工作台'];
  }, [pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={232}
        theme="light"
        style={{
          borderRight: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'auto',
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: '1px solid #e2e8f0',
            gap: 10,
            cursor: 'pointer',
          }}
          onClick={() => router.push('/')}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            P
          </div>
          {!collapsed && (
            <Title level={5} style={{ margin: 0, color: '#0f172a', fontSize: 16 }}>
              PrismReview
            </Title>
          )}
        </div>

        <div style={{ padding: '12px 8px' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#94a3b8',
              letterSpacing: 1,
              padding: '8px 12px 4px',
              display: collapsed ? 'none' : 'block',
            }}
          >
            REVIEW
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ borderRight: 0, flex: 1 }}
            items={NAV.map((n) => ({
              key: n.key,
              icon: n.icon,
              label: (
                <Space>
                  {!collapsed && <span>{n.label}</span>}
                  {n.badge && !collapsed && (
                    <Badge
                      count={n.badge}
                      style={{ backgroundColor: '#f59e0b', fontSize: 10, height: 16, lineHeight: '16px' }}
                    />
                  )}
                </Space>
              ),
              onClick: () => router.push(n.key !== '/' ? n.key : '/'),
            }))}
          />
        </div>

        {/* Sessler collapse trigger */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 48,
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#64748b',
          }}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </div>
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Space size={4}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>
              {breadcrumbs.map((c, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: '0 8px' }}>/</span>}
                  <span style={i === breadcrumbs.length - 1 ? { color: '#0f172a', fontWeight: 600 } : {}}>
                    {c}
                  </span>
                </span>
              ))}
            </span>
          </Space>

          <Space size={16}>
            <Tooltip title="通知中心（占位）">
              <Badge count={0} size="small">
                <Button type="text" icon={<BellOutlined />} />
              </Badge>
            </Tooltip>
            <Tooltip title="切换主题">
              <Button type="text" icon={<BulbOutlined />} onClick={onThemeChange} />
            </Tooltip>
            <span style={{ color: '#e2e8f0' }}>|</span>
            <Space>
              <Avatar
                size={32}
                style={{ backgroundColor: '#6366f1', fontWeight: 600, fontSize: 14 }}
              >
                {CURRENT_USER.name.charAt(0).toUpperCase()}
              </Avatar>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span style={{ fontWeight: 500, color: '#0f172a', fontSize: 14 }}>
                  {CURRENT_USER.name}
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {ROLE_LABEL[CURRENT_USER.role] ?? CURRENT_USER.role}
                </span>
              </span>
            </Space>
          </Space>
        </Header>

        <Content
          style={{
            margin: 0,
            padding: 24,
            background: '#f8fafc',
            minHeight: 'calc(100vh - 64px)',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
