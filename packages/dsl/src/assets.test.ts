import { describe, expect, it } from 'vitest';
import { finalDslSchema } from './schema/dsl';
import { withCriticalAssets } from './assets';

function dsl(nodes: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return finalDslSchema.parse({
    schemaVersion: '1.1.0',
    meta: { activityId: 'a1', title: 't' },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: Object.keys(nodes) },
      ...Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, { parent: 'ROOT', ...n }])),
    },
    ...extra,
  });
}

describe('withCriticalAssets', () => {
  it('按渲染顺序收集静态图片；轮播只取第一张；跳过弹窗、条件节点与绑定表达式', () => {
    const result = withCriticalAssets(
      dsl({
        banner: { type: { resolvedName: 'Image' }, props: { src: 'https://cdn.test/banner' } },
        modal: {
          type: { resolvedName: 'Modal' },
          props: { bgImage: 'https://cdn.test/modal.png' },
        },
        swiper: {
          type: { resolvedName: 'Swiper' },
          props: { items: [{ image: '/img/1.png' }, { image: '/img/2.png' }] },
        },
        maybe: {
          type: { resolvedName: 'Image' },
          props: { src: 'https://cdn.test/maybe.png' },
          control: { if: '{{ state.x }}' },
        },
        bound: { type: { resolvedName: 'Image' }, props: { src: '{{ item.url }}' } },
        text: { type: { resolvedName: 'Text' }, props: { content: 'https://not-an-image.test' } },
      }),
    );
    expect(result.assets.map((a) => a.url)).toEqual(['https://cdn.test/banner', '/img/1.png']);
    expect(result.assets.every((a) => a.critical && a.type === 'image')).toBe(true);
  });

  it('运营手工标过的保留，不重复添加；最多取 limit 张', () => {
    const input = dsl(
      {
        a: { type: { resolvedName: 'Image' }, props: { src: '/a.png' } },
        b: { type: { resolvedName: 'Image' }, props: { src: '/b.png' } },
        c: { type: { resolvedName: 'Image' }, props: { src: '/c.png' } },
      },
      { assets: [{ id: 'manual', url: '/a.png', type: 'image', critical: true }] },
    );
    const result = withCriticalAssets(input, 2);
    expect(result.assets.map((a) => a.url)).toEqual(['/a.png', '/b.png']);
    expect(withCriticalAssets(dsl({}))).toEqual(dsl({}));
  });
});
