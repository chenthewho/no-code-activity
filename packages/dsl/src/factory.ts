import { ROOT_NODE_ID } from '@nca/shared';
import { DSL_SCHEMA_VERSION } from './version';
import { finalDslSchema, type FinalDsl } from './schema/dsl';

/** 新建活动时的空白 DSL：只有一个根页面容器 */
export function createEmptyDsl(activityId: string, title: string): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: DSL_SCHEMA_VERSION,
    meta: { activityId, title },
    dataSources: [],
    craftJson: {
      [ROOT_NODE_ID]: {
        type: { resolvedName: 'Page' },
        isCanvas: true,
        displayName: '页面',
        props: {},
        nodes: [],
        linkedNodes: {},
      },
    },
    events: [],
    assets: [],
    initialState: {},
  });
}
