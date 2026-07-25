import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, mergeStyle, toSize, type CommonStyleProps } from '../utils/style';

export interface SwiperItem {
  image: string;
  link?: string;
}

export interface SwiperProps extends CommonStyleProps {
  /** 可直接配置，也可绑定 {{ dataSource.banners }} */
  items?: SwiperItem[];
  autoplay?: boolean;
  interval?: number;
  showIndicator?: boolean;
  indicatorColor?: string;
  indicatorActiveColor?: string;
}

function Swiper({ children: _children, emit, editing, ...props }: MaterialComponentProps<SwiperProps>) {
  const items = Array.isArray(props.items) ? props.items : [];
  const [index, setIndex] = useState(0);
  const count = items.length;
  const activeIndex = count > 0 ? index % count : 0;

  // 编辑态不自动轮播：画布内容不停变动会让运营无法稳定选中某一屏
  const autoplay = Boolean(props.autoplay) && !editing && count > 1;
  const intervalMs = Math.max(1000, props.interval ?? 3000);

  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (countRef.current > 0 ? (prev + 1) % countRef.current : 0));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoplay, intervalMs]);

  if (count === 0) {
    return <div className="nca-swiper nca-swiper--empty">请配置轮播图</div>;
  }

  const trackStyle: CSSProperties = {
    display: 'flex',
    width: `${count * 100}%`,
    transform: `translateX(-${(activeIndex * 100) / count}%)`,
    transition: 'transform .35s ease',
  };

  return (
    <div
      className="nca-swiper"
      style={mergeStyle(commonStyle(props), {
        overflow: 'hidden',
        position: 'relative',
        height: toSize(props.height) ?? '320px',
      })}
    >
      <div className="nca-swiper__track" style={trackStyle}>
        {items.map((item, i) => (
          <div
            key={i}
            className="nca-swiper__slide"
            style={{ width: `${100 / count}%`, flexShrink: 0 }}
            onClick={() => emit?.('itemClick', { index: i, link: item.link })}
          >
            <img src={item.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
      {props.showIndicator !== false && count > 1 && (
        <div className="nca-swiper__indicator">
          {items.map((_, i) => (
            <span
              key={i}
              className="nca-swiper__dot"
              style={{
                backgroundColor:
                  i === activeIndex
                    ? props.indicatorActiveColor || '#ffffff'
                    : props.indicatorColor || 'rgba(255,255,255,.5)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const SwiperMaterial = defineMaterial<SwiperProps>({
  Component: Swiper,
  meta: defineMeta({
    name: 'Swiper',
    version: '1.0.0',
    title: '轮播图',
    category: MATERIAL_CATEGORY.MEDIA,
    icon: 'images',
    defaultProps: { autoplay: true, interval: 3000, showIndicator: true, height: 320 },
    events: [{ name: 'itemClick', label: '点击某一项', payloadKeys: ['index', 'link'] }],
    propsSchema: [
      prop({
        key: 'items',
        label: '轮播项',
        editor: 'json',
        bindable: true,
        help: '数组，每项 { image, link }；也可绑定数据源',
      }),
      prop({ key: 'autoplay', label: '自动播放', editor: 'boolean' }),
      prop({
        key: 'interval',
        label: '切换间隔(ms)',
        editor: 'number',
        min: 1000,
        max: 20000,
        step: 500,
        visibleWhen: '{{ props.autoplay }}',
      }),
      prop({ key: 'showIndicator', label: '显示指示器', editor: 'boolean' }),
      styleProp({
        key: 'indicatorColor',
        label: '指示器颜色',
        editor: 'color',
        visibleWhen: '{{ props.showIndicator }}',
      }),
      styleProp({
        key: 'indicatorActiveColor',
        label: '指示器选中色',
        editor: 'color',
        visibleWhen: '{{ props.showIndicator }}',
      }),
      ...commonStyleSchema,
    ],
  }),
});
