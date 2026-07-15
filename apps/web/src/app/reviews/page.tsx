'use client';
import React, { useEffect, useState } from 'react';
import { Typography, Table, Tag, Space, Button, Alert, Input, Popconfirm, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { apiClient, ReviewListItem, GetReviewsParams } from '../../lib/api-client/client';

const { Title, Text } = Typography;
const { CheckableTag } = Tag;

// Mirror of the server's 9-state enum (ReviewsService.REVIEW_STATUS_FLOW).
// Do not add pre-9.3 aliases (draft / diagnosing / ready / summarizing) —
// the backend no longer emits them. See docs/coordination/Codebase_Audit_Report.md §3.
const statusMap: Record<string, { text: string; color: string }> = {
  created: { text: '已创建', color: 'default' },
  diagnosed: { text: '已诊断', color: 'processing' },
  running: { text: '评审中', color: 'processing' },
  interrupted: { text: '已中断(HITL)', color: 'warning' },
  summarized: { text: '本轮已汇总', color: 'processing' },
  completed: { text: '已完成', color: 'success' },
  failed: { text: '失败', color: 'error' },
  aborted: { text: '已中止', color: 'warning' },
  archived: { text: '已归档', color: 'default' },
};

// 状态筛选桶（多选）；"进行中" = 一组活跃状态，"已归档" = archived
const STATUS_BUCKETS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'active', label: '进行中', statuses: ['running', 'interrupted', 'summarized'] },
  { key: 'created', label: '已创建', statuses: ['created'] },
  { key: 'diagnosed', label: '已诊断', statuses: ['diagnosed'] },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'failed', label: '失败', statuses: ['failed'] },
  { key: 'aborted', label: '已中止', statuses: ['aborted'] },
  { key: 'archived', label: '已归档', statuses: ['archived'] },
];

// 可归档的源状态：completed / failed / aborted / interrupted（running 由后端先中断再归档）
const ARCHIVE_ALLOWED = new Set(['completed', 'failed', 'aborted', 'interrupted', 'running']);

function buildStatusParam(selected: string[]): string | undefined {
  if (!selected.length) return undefined;
  const set = new Set<string>();
  for (const key of selected) {
    const bucket = STATUS_BUCKETS.find((b) => b.key === key);
    if (bucket) bucket.statuses.forEach((s) => set.add(s));
  }
  return set.size ? Array.from(set).join(',') : undefined;
}

export default function ReviewListPage() {
  const router = useRouter();
  const [data, setData] = useState<ReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // debounced 值，真正用于请求

  // 搜索框 debounce(300ms)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchReviews = async (page: number, pageSize: number, buckets: string[], q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params: GetReviewsParams = { page, limit: pageSize };
      const statusParam = buildStatusParam(buckets);
      if (statusParam) params.status = statusParam;
      if (q) params.search = q;
      const res = await apiClient.getReviews(params);
      setData(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || '获取评审列表失败。');
    } finally {
      setLoading(false);
    }
  };

  // 搜索词 / 筛选 / 分页变化时重新拉取（搜索与筛选切换时回到第 1 页）
  useEffect(() => {
    fetchReviews(pagination.current, pagination.pageSize, selectedBuckets, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, selectedBuckets, search]);

  const handleTableChange = (newPagination: any) => {
    setPagination({
      current: newPagination.current,
      pageSize: newPagination.pageSize,
    });
  };

  const toggleBucket = (key: string) => {
    setSelectedBuckets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const clearBuckets = () => {
    setSelectedBuckets([]);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleArchive = async (id: string) => {
    try {
      await apiClient.archiveReview(id);
      await fetchReviews(pagination.current, pagination.pageSize, selectedBuckets, search);
    } catch (err: any) {
      setError(err.message || '归档失败。');
    }
  };

  const handleUnarchive = async (id: string) => {
    try {
      await apiClient.unarchiveReview(id);
      await fetchReviews(pagination.current, pagination.pageSize, selectedBuckets, search);
    } catch (err: any) {
      setError(err.message || '取消归档失败。');
    }
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
        const isArchived = record.status === 'archived';
        const canArchive = ARCHIVE_ALLOWED.has(record.status);

        return (
          <Space size="middle" wrap>
            {/* 诊断页入口（依据状态变化文案） */}
            <Button
              type={isCreated || isDiagnosed ? 'primary' : 'link'}
              size="small"
              onClick={() => router.push(`/reviews/${record.id}`)}
            >
              {isCreated ? '开始诊断' : isDiagnosed ? '确认评审团' : '查看诊断'}
            </Button>

            {/* 进入会议室 */}
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

            {/* 查看报告 */}
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

            {/* 归档 / 取消归档 */}
            {canArchive && (
              <Popconfirm
                title="确认归档该评审？"
                description="归档后将从默认列表隐藏，可随时取消归档。"
                okText="归档"
                cancelText="取消"
                onConfirm={() => handleArchive(record.id)}
              >
                <Button type="link" size="small" danger>
                  归档
                </Button>
              </Popconfirm>
            )}
            {isArchived && (
              <Button type="link" size="small" onClick={() => handleUnarchive(record.id)}>
                取消归档
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  const hasFilter = !!search || selectedBuckets.length > 0;
  const emptyText = hasFilter ? (
    <Empty description="未找到匹配的评审" />
  ) : (
    <Empty description={<span>还没有评审，点击右上角「新建评审」创建第一个</span>} />
  );

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
          action={<Button onClick={() => fetchReviews(pagination.current, pagination.pageSize, selectedBuckets, search)}>重试</Button>}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索评审标题或目标..."
          value={searchInput}
          onChange={handleSearchChange}
          style={{ width: 280 }}
        />
        <Space size={[4, 4]} wrap>
          <CheckableTag
            checked={selectedBuckets.length === 0}
            onChange={clearBuckets}
          >
            全部
          </CheckableTag>
          {STATUS_BUCKETS.map((b) => (
            <CheckableTag
              key={b.key}
              checked={selectedBuckets.includes(b.key)}
              onChange={() => toggleBucket(b.key)}
            >
              {b.label}
            </CheckableTag>
          ))}
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        locale={{ emptyText }}
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
