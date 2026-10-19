import { useState } from 'react';
import { Button, Card, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { CrownOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityMemberRole } from '@nca/shared';
import { activityApi, userApi, type ActivityMembers } from '../api';

const ROLE_OPTIONS: { value: ActivityMemberRole; label: string }[] = [
  { value: 'editor', label: '可编辑' },
  { value: 'viewer', label: '只读' },
];

type MemberRow = ActivityMembers['members'][number];

/**
 * 协作成员。没有「全部活动」数据范围的运营，只看得到自己负责或被拉进来的活动——
 * 想让同事一起改，就在这里加人，而不是给他放开全部活动。
 */
export function ActivityMemberCard({
  activityId,
  canManage,
}: {
  activityId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<string>();
  const [role, setRole] = useState<ActivityMemberRole>('editor');

  const { data } = useQuery({
    queryKey: ['members', activityId],
    queryFn: () => activityApi.members(activityId),
  });
  const { data: candidates = [], isFetching } = useQuery({
    queryKey: ['user-lookup', keyword],
    queryFn: () => userApi.lookup(keyword),
    enabled: adding || transferring,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['members', activityId] });
    void queryClient.invalidateQueries({ queryKey: ['activity', activityId] });
  };
  const onError = (err: Error) => void message.error(err.message);
  const closeAll = () => {
    setAdding(false);
    setTransferring(false);
    setPicked(undefined);
    setKeyword('');
  };

  const upsert = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: string; nextRole: ActivityMemberRole }) =>
      activityApi.upsertMember(activityId, userId, nextRole),
    onSuccess: () => {
      void message.success('成员已更新');
      closeAll();
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => activityApi.removeMember(activityId, userId),
    onSuccess: () => {
      void message.success('已移除');
      refresh();
    },
    onError,
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => activityApi.transferOwner(activityId, userId),
    onSuccess: () => {
      void message.success('负责人已转交，你保留编辑权限');
      closeAll();
      refresh();
    },
    onError,
  });

  const excluded = new Set([data?.owner.id, ...(data?.members.map((m) => m.id) ?? [])]);
  const options = candidates
    .filter((u) => (transferring ? u.id !== data?.owner.id : !excluded.has(u.id)))
    .map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }));

  const columns = [
    {
      title: '成员',
      render: (_: unknown, row: MemberRow) => (
        <span>
          {row.nickname} <span style={{ color: '#8c8c8c' }}>@{row.username}</span>
        </span>
      ),
    },
    {
      title: '权限',
      dataIndex: 'role',
      width: 140,
      render: (value: ActivityMemberRole, row: MemberRow) =>
        canManage ? (
          <Select
            size="small"
            value={value}
            options={ROLE_OPTIONS}
            style={{ width: 100 }}
            onChange={(next) => upsert.mutate({ userId: row.id, nextRole: next })}
          />
        ) : (
          <Tag>{ROLE_OPTIONS.find((o) => o.value === value)?.label}</Tag>
        ),
    },
    {
      title: '加入时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    ...(canManage
      ? [
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: MemberRow) => (
              <Popconfirm title="移除该成员？" onConfirm={() => remove.mutate(row.id)}>
                <a style={{ color: '#ff4d4f' }}>移除</a>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card
      title="协作成员"
      extra={
        canManage && (
          <Space>
            <Button size="small" icon={<CrownOutlined />} onClick={() => setTransferring(true)}>
              转交负责人
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setAdding(true)}
            >
              添加成员
            </Button>
          </Space>
        )
      }
    >
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: '#8c8c8c' }}>负责人：</span>
        {data ? (
          <Tag icon={<CrownOutlined />} color="gold">
            {data.owner.nickname}（{data.owner.username}）
          </Tag>
        ) : (
          '—'
        )}
      </div>
      <Table
        rowKey="id"
        size="small"
        dataSource={data?.members ?? []}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '还没有协作成员' }}
      />

      <Modal
        title={transferring ? '转交负责人' : '添加协作成员'}
        open={adding || transferring}
        onCancel={closeAll}
        okButtonProps={{ disabled: !picked }}
        confirmLoading={upsert.isPending || transfer.isPending}
        onOk={() => {
          if (!picked) return;
          if (transferring) transfer.mutate(picked);
          else upsert.mutate({ userId: picked, nextRole: role });
        }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            showSearch
            filterOption={false}
            placeholder="搜索用户名或昵称"
            style={{ width: '100%' }}
            value={picked}
            options={options}
            loading={isFetching}
            onSearch={setKeyword}
            onChange={setPicked}
          />
          {transferring ? (
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              转交后你将成为该活动的可编辑成员。
            </span>
          ) : (
            <Select value={role} options={ROLE_OPTIONS} onChange={setRole} style={{ width: 140 }} />
          )}
        </Space>
      </Modal>
    </Card>
  );
}
