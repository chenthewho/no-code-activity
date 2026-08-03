import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { dslPatchSchema } from '@nca/dsl';
import { capabilitiesFor, type Capability } from '../capability/registry';

/**
 * 工具定义全部从既有 schema 派生，不手写。
 *
 * 补丁协议的 JSON Schema 直接由 dslPatchSchema 转出来——协议加一个算子，
 * 模型第二天就会用，没有「代码改了忘了同步 prompt」这一类问题。
 *
 * 不开 strict：propsRecord 里的 jsonValue 是递归类型（转出来带 $ref/$defs），
 * 结构化输出的严格模式表达不了。反正落库前还要过一遍 zod，错了把报错喂回去
 * 让模型自己改，比在 schema 层硬卡更实际。
 */

type JsonSchema = Record<string, unknown>;

/** zod 生成的是带 $schema/$defs 的完整文档，这里拆成「主体」与「定义表」两半 */
function splitPatchSchema(): { body: JsonSchema; defs: JsonSchema } {
  const full = z.toJSONSchema(dslPatchSchema, { io: 'input' }) as JsonSchema;
  const { $schema: _schema, $defs, ...body } = full;
  return { body, defs: ($defs as JsonSchema) ?? {} };
}

function zodToInputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const full = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;
  delete full.$schema;
  // Anthropic 要求顶层是 object
  if (full.type !== 'object') {
    return { type: 'object', properties: {} };
  }
  return full as unknown as Anthropic.Tool.InputSchema;
}

function applyPatchesTool(capability: Capability): Anthropic.Tool {
  const { body, defs } = splitPatchSchema();
  return {
    name: capability.name,
    description: capability.description,
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '一句话说明这批改动做了什么，会原样显示给运营看',
        },
        patches: {
          type: 'array',
          minItems: 1,
          description: '按执行顺序排列；后面的补丁可以用 @ref 指向前面新建的节点',
          items: body,
        },
      },
      required: ['summary', 'patches'],
      // $ref 是相对整个 input_schema 的根，所以 $defs 必须提到这一层
      $defs: defs,
    } as unknown as Anthropic.Tool.InputSchema,
  };
}

/** 按调用方的权限裁剪工具集：无权发布的人，模型那边压根看不到发布这个工具 */
export function buildTools(permissions: readonly string[]): Anthropic.Tool[] {
  return capabilitiesFor(permissions).map((capability) =>
    capability.name === 'apply_patches'
      ? applyPatchesTool(capability)
      : {
          name: capability.name,
          description: capability.description,
          input_schema: zodToInputSchema(capability.input),
        },
  );
}
