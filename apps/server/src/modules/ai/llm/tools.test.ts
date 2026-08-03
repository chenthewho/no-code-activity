import { describe, expect, it } from 'vitest';
import { PERMISSION } from '@nca/shared';
import { dslPatchSchema } from '@nca/dsl';
import { buildTools } from './tools';
import { CAPABILITIES, capabilitiesFor } from '../capability/registry';

describe('能力注册表', () => {
  it('按权限裁剪：无权发布的人看不到发布工具', () => {
    const names = capabilitiesFor([PERMISSION.AI_USE]).map((c) => c.name);
    expect(names).toContain('apply_patches');
    expect(names).not.toContain('publish_activity');
  });

  it('读能力不要权限，谁都能用', () => {
    const names = capabilitiesFor([]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['read_page', 'list_templates']));
    expect(names).not.toContain('apply_patches');
  });

  it('system:manage 直通所有能力', () => {
    expect(capabilitiesFor([PERMISSION.SYSTEM_MANAGE])).toHaveLength(CAPABILITIES.length);
  });

  it('写操作要确认、发布必须人工，这套映射不能被改松', () => {
    const byName = new Map(CAPABILITIES.map((c) => [c.name, c]));
    expect(byName.get('read_page')!.confirm).toBe('none');
    expect(byName.get('apply_patches')!.confirm).toBe('approve');
    expect(byName.get('publish_activity')!.confirm).toBe('human');
    expect(byName.get('publish_activity')!.permission).toBe(PERMISSION.AI_PUBLISH);
  });
});

describe('工具 schema 派生', () => {
  const tools = buildTools([PERMISSION.SYSTEM_MANAGE]);
  const applyPatches = tools.find((t) => t.name === 'apply_patches')!;

  it('每个能力都转出一个合法的 object 入参 schema', () => {
    expect(tools.length).toBe(CAPABILITIES.length);
    for (const tool of tools) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });

  it('补丁工具的 schema 直接来自 dslPatchSchema，算子数量对得上', () => {
    const schema = applyPatches.input_schema as unknown as {
      properties: { patches: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } };
      $defs: Record<string, unknown>;
    };
    const variants = schema.properties.patches.items.oneOf ?? schema.properties.patches.items.anyOf;
    expect(variants).toBeDefined();
    // 协议里有几个算子，工具就应该暴露几个，不需要任何手工同步
    expect(variants!.length).toBe(dslPatchSchema.options.length);
  });

  it('$defs 提到 input_schema 根上，否则 $ref 解析不到', () => {
    const schema = applyPatches.input_schema as unknown as Record<string, unknown>;
    expect(schema.$defs).toBeDefined();
    // 递归的 jsonValue 会被转成 $ref，引用的是根下的 $defs
    const serialized = JSON.stringify(schema);
    const refs = [...serialized.matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)].map((m) => m[1]!);
    const defs = schema.$defs as Record<string, unknown>;
    for (const ref of refs) {
      expect(Object.keys(defs)).toContain(ref);
    }
  });

  it('summary 是必填——那句话要原样给运营看', () => {
    const schema = applyPatches.input_schema as unknown as { required: string[] };
    expect(schema.required).toContain('summary');
    expect(schema.required).toContain('patches');
  });
});
