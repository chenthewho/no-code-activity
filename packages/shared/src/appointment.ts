/**
 * 预约场次（时段）。场次在后台按活动配置：名称、开始 / 结束时间、名额。
 * 名额与截止由服务端执行，C 端组件只负责展示——前端看到「还有名额」不代表一定约得上。
 */

/** open 可约；full 约满；closed 已开场或已结束，停止预约 */
export type AppointmentSceneStatus = 'open' | 'full' | 'closed';

/** C 端看到的场次 */
export interface AppointmentSceneView {
  sceneId: string;
  name: string;
  /** ISO 时间；不设表示不限时段 */
  startAt?: string;
  endAt?: string;
  /** 名额；null 表示不限 */
  capacity: number | null;
  /** 剩余名额；不限名额时为 null */
  remaining: number | null;
  status: AppointmentSceneStatus;
  /** 当前访问者是否已约过这一场 */
  booked: boolean;
}
