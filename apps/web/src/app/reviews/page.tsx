'use client';
import React, { useEffect, useState } from 'react';
import { Typography, Table, Tag, Space, Button, Alert, Segmented, Tooltip } from 'antd';
import { useRouter } from 'next/navigation';
import { apiClient, ReviewListItem, GetReviewsParams } from '../../lib/api-client/client';

const { Title, Text } = Typography;

const statusMap: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  diagnosing: { text: '诊断中', color: 'processing' },
  ready: { text: '待评审', color: 'processing' },
  running: { text: '评审中', color: 'processing' },
  interrupted: { text: '已中断', color: 'warning' },
  summarizing: { text: '总结中', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  failed: { text: '失败', color: 'error' },
  archived: { text: '已归档', color: 'default' },
};

export default function ReviewListPage() {
  const router = useRouter();
  const [data, setData] = useState<ReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchReviews = async (page: number, pageSize: number, status: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: GetReviewsParams = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      if (status !== 'all') {
        params.status = status;
      }
      const res = await apiClient.getReviews(params);
      setData(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || '获取评审列表失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews(pagination.current, pagination.pageSize, statusFilter);
  }, [pagination.current, pagination.pageSize, statusFilter]);

  const handleTableChange = (newPagination: any) => {
    setPagination({
      current: newPagination.current,
      pageSize: newPagination.pageSize,
    });
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '摘要',
      dataIndex: 'objective',
      key: 'objective',
      width: '25%',
      render: (text: string) => (
        <Text type="secondary" ellipsis={{ tooltip: text }}>
          {text}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => {
        const config = statusMap[val] || { text: val, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      render: (val: string) => <Tag>{val}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: ReviewListItem) => {
        const isCreated = record.status === 'created';
        const isDiagnosed = record.status === 'diagnosed';
        const isRunning = record.status === 'running' || record.status === 'interrupted' || record.status === 'summarized';
        const isCompleted = record.status === 'completed';
        const isFailed = record.status === 'failed';

        return (
          <Space size="middle">
            {/* 诊断页入口 (依据状态变化文案) */}
            <Button
              type={isCreated || isDiagnosed ? 'primary' : 'link'}
              size="small"
              onClick={() => router.push(`/reviews/${record.id}`)}
            >
              {isCreated ? '开始诊断' : isDiagnosed ? '确认评审团' : '查看诊断'}
            </Button>

            {/* 进入会议室 */}
            <Tooltip
              title={
                isCreated
                  ? '请先完成诊断并确认评审团'
                  : isDiagnosed
                  ? '请先确认评审团并开始评审'
                  : ''
              }
            >
              <Button
                type={isRunning ? 'primary' : 'link'}
                size="small"
                disabled={isCreated || isDiagnosed || isFailed}
                onClick={() => {
                  if (!(isCreated || isDiagnosed || isFailed)) {
                    router.push(`/reviews/${record.id}/meeting`);
                  }
                }}
              >
                进入会议室
              </Button>
            </Tooltip>

            {/* 查看报告 */}
            <Tooltip
              title={
                isCreated
                  ? '评审尚未开始，暂无报告'
                  : isDiagnosed
                  ? '评审尚未完成，暂无报告'
                  : isRunning
                  ? '评审完成后可查看报告'
                  : ''
              }
            >
              <Button
                type={isCompleted ? 'primary' : 'link'}
                size="small"
                disabled={!isCompleted}
                onClick={() => {
                  if (isCompleted) {
                    router.push(`/reviews/${record.id}/report`);
                  }
                }}
              >
                查看报告
              </Button>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>我的评审</Title>
        <Button type="primary" onClick={() => router.push('/reviews/new')}>新建评审</Button>
      </div>

      {error && (
        <Alert
          message="加载失败"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          action={<Button onClick={() => fetchReviews(pagination.current, pagination.pageSize, statusFilter)}>重试</Button>}
        />
      )}

      <div style={{ marginBottom: 16 }}>
        <Segmented
          options={[
            { label: '全部', value: 'all' },
            { label: '已创建', value: 'created' },
            { label: '已诊断', value: 'diagnosed' },
            { label: '评审中', value: 'running' },
            { label: '已完成', value: 'completed' },
            { label: '失败', value: 'failed' },
          ]}
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val as string);
            setPagination(prev => ({ ...prev, current: 1 }));
          }}
        />
      </div>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: total,
          showSizeChanger: true,
        }}
        onChange={handleTableChange}
      />
    </div>
  );
}
