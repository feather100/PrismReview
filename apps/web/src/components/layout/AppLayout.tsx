'use client';
import React from 'react';
import { Layout, Menu, Typography, theme as antTheme } from 'antd';
import { useRouter, usePathname } from 'next/navigation';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token } = antTheme.useToken();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider 
        theme="light" 
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Title level={4} style={{ margin: 0, color: token.colorPrimary }}>PrismReview</Title>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          style={{ borderRight: 0 }}
          items={[
            { key: '/', label: '控制台', onClick: () => router.push('/') },
            { key: '/reviews', label: '我的评审', onClick: () => router.push('/reviews') },
            { key: '/reviews/new', label: '新建评审', onClick: () => router.push('/reviews/new') },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <div>管理员</div>
        </Header>
        <Content style={{ margin: '24px', background: token.colorBgContainer, padding: 24, borderRadius: token.borderRadiusLG, minHeight: 280 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
