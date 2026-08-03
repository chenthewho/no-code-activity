import { describe, expect, it } from 'vitest';
import { buildActivityUrl } from './activity-url';

describe('活动页地址', () => {
  it('站点根拼上 /act/:id', () => {
    expect(buildActivityUrl('http://localhost:5180', 'act_1')).toBe(
      'http://localhost:5180/act/act_1',
    );
  });

  it('容忍配置里多写的尾斜杠，不拼出双斜杠', () => {
    expect(buildActivityUrl('https://act.example.com//', 'act_1')).toBe(
      'https://act.example.com/act/act_1',
    );
  });

  it('带路径前缀的站点根照样接得上', () => {
    expect(buildActivityUrl('https://cdn.example.com/h5', 'act_1')).toBe(
      'https://cdn.example.com/h5/act/act_1',
    );
  });
});
