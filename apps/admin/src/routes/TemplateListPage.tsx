import { Card, Empty, List } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { templateApi } from '../api';

export function TemplateListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templateApi.list({ page: 1, pageSize: 20 }),
  });

  return (
    <Card title="模板中心">
      <List
        loading={isLoading}
        grid={{ gutter: 16, column: 4 }}
        dataSource={data?.list ?? []}
        locale={{
          emptyText: <Empty description="还没有模板，可在设计器中把活动另存为模板" />,
        }}
        renderItem={(item) => (
          <List.Item>
            <Card
              hoverable
              size="small"
              cover={
                item.cover ? (
                  <img alt={item.title} src={item.cover} style={{ height: 160, objectFit: 'cover' }} />
                ) : (
                  <div style={{ height: 160, background: '#fafafa' }} />
                )
              }
            >
              <Card.Meta title={item.title} description={`已被使用 ${item.useCount} 次`} />
            </Card>
          </List.Item>
        )}
      />
    </Card>
  );
}
