import { useState } from 'react';
import { Button, Image, Input, Modal, Space, Spin, Tabs, Upload, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assetApi } from '../../api';

interface Props {
  value?: string;
  placeholder?: string;
  onChange: (url: string) => void;
}

/**
 * 图片选择器：上传 / 素材库 / 直接填地址三条路。
 * 保留「直接填地址」是因为绑定表达式（{{ item.avatar }}）也走这个编辑器。
 */
export function ImagePicker({ value, placeholder, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={value}
          placeholder={placeholder ?? '图片地址，支持 {{ }} 绑定'}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button onClick={() => setOpen(true)}>选择</Button>
      </Space.Compact>

      {value && !value.includes('{{') && (
        <Image
          src={value}
          alt=""
          height={56}
          style={{ marginTop: 6, objectFit: 'contain', background: '#fafafa' }}
          fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
        />
      )}

      <Modal
        title="选择图片"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Tabs
          items={[
            {
              key: 'upload',
              label: '上传',
              children: (
                <UploadTab
                  onPicked={(url) => {
                    onChange(url);
                    setOpen(false);
                  }}
                />
              ),
            },
            {
              key: 'library',
              label: '素材库',
              children: (
                <LibraryTab
                  onPicked={(url) => {
                    onChange(url);
                    setOpen(false);
                  }}
                />
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}

function UploadTab({ onPicked }: { onPicked: (url: string) => void }) {
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: (file: File) => assetApi.upload(file),
    onSuccess: (result) => {
      // 内容寻址：同一张图重复上传会命中已有记录，明确告诉用户而不是装作新传了一份
      void message.success(result.reused ? '该图片已在素材库中，直接复用' : '上传成功');
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onPicked(result.url);
    },
    onError: (err: Error) => void message.error(err.message),
  });

  return (
    <Upload.Dragger
      accept="image/*"
      showUploadList={false}
      multiple={false}
      beforeUpload={(file) => {
        uploadMutation.mutate(file);
        // 交给自己的 mutation 发请求，阻止 antd 的默认上传
        return false;
      }}
      disabled={uploadMutation.isPending}
      style={{ padding: 24 }}
    >
      {uploadMutation.isPending ? (
        <Spin tip="上传中" />
      ) : (
        <>
          <p style={{ fontSize: 32, margin: 0 }}>📁</p>
          <p>点击或拖拽图片到此处</p>
          <p style={{ color: '#999', fontSize: 12 }}>支持 png / jpg / gif / webp / svg，最大 10MB</p>
        </>
      )}
    </Upload.Dragger>
  );
}

function LibraryTab({ onPicked }: { onPicked: (url: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: () => assetApi.list({ page: 1, pageSize: 60, type: 'image' }),
  });

  if (isLoading) return <Spin />;
  if (!data || data.list.length === 0) {
    return <div style={{ padding: 40, color: '#999', textAlign: 'center' }}>素材库还是空的</div>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 12,
        maxHeight: 400,
        overflow: 'auto',
      }}
    >
      {data.list.map((asset) => (
        <div
          key={asset.id}
          onClick={() => onPicked(asset.url)}
          style={{
            height: 120,
            padding: 4,
            cursor: 'pointer',
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
          }}
        >
          <img
            src={asset.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      ))}
    </div>
  );
}
