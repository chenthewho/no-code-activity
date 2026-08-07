import type { ComponentType } from 'react';
import type { MaterialMeta } from '@nca/dsl';
import type { MaterialDefinition } from './types';

import { PageMaterial } from './components/Page';
import { ContainerMaterial } from './components/Container';
import { TextMaterial } from './components/Text';
import { ImageMaterial } from './components/Image';
import { ButtonMaterial } from './components/Button';
import { ModalMaterial } from './components/Modal';
import { CountdownMaterial } from './components/Countdown';
import { SwiperMaterial } from './components/Swiper';
import { RankListMaterial } from './components/RankList';
import { LotteryMaterial } from './components/Lottery';
import { LoginMaterial } from './components/Login';
import { BindRoleMaterial } from './components/BindRole';
import { RulesMaterial } from './components/Rules';
import { RewardListMaterial } from './components/RewardList';
import { InviteFriendMaterial } from './components/InviteFriend';
import { InviteRecordMaterial } from './components/InviteRecord';
import { FormMaterial } from './components/Form';
import { AppointmentMaterial } from './components/Appointment';

export * from './types';
export * from './utils/style';
export * from './utils/schema';

export { PageMaterial } from './components/Page';
export { ContainerMaterial } from './components/Container';
export { TextMaterial } from './components/Text';
export { ImageMaterial } from './components/Image';
export { ButtonMaterial } from './components/Button';
export { ModalMaterial } from './components/Modal';
export { CountdownMaterial } from './components/Countdown';
export { SwiperMaterial } from './components/Swiper';
export { RankListMaterial } from './components/RankList';
export { LotteryMaterial } from './components/Lottery';
export { LoginMaterial } from './components/Login';
export { BindRoleMaterial } from './components/BindRole';
export { RulesMaterial } from './components/Rules';
export { RewardListMaterial } from './components/RewardList';
export { InviteFriendMaterial } from './components/InviteFriend';
export { InviteRecordMaterial } from './components/InviteRecord';
export { FormMaterial } from './components/Form';
export { AppointmentMaterial } from './components/Appointment';

export type { PageProps } from './components/Page';
export type { ContainerProps } from './components/Container';
export type { TextProps } from './components/Text';
export type { ImageProps } from './components/Image';
export type { ButtonProps } from './components/Button';
export type { ModalProps } from './components/Modal';
export type { CountdownProps } from './components/Countdown';
export type { SwiperProps, SwiperItem } from './components/Swiper';
export type { RankListProps } from './components/RankList';
export type { LotteryProps } from './components/Lottery';
export type { LoginProps } from './components/Login';
export type { BindRoleProps } from './components/BindRole';
export type { RulesProps } from './components/Rules';
export type { RewardListProps } from './components/RewardList';
export type { InviteFriendProps } from './components/InviteFriend';
export type { InviteRecordProps } from './components/InviteRecord';
export type { FormProps, FormField } from './components/Form';
export type { AppointmentProps } from './components/Appointment';

/**
 * 物料总表 —— 全平台唯一的物料来源。
 * 设计器工具箱、渲染器 componentMap、DSL 校验的 knownMaterials 全部从这里派生，
 * 三者不可能不一致。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const materials: MaterialDefinition<any>[] = [
  PageMaterial,
  ContainerMaterial,
  TextMaterial,
  ImageMaterial,
  ButtonMaterial,
  ModalMaterial,
  CountdownMaterial,
  SwiperMaterial,
  RankListMaterial,
  LotteryMaterial,
  LoginMaterial,
  BindRoleMaterial,
  RulesMaterial,
  RewardListMaterial,
  InviteFriendMaterial,
  InviteRecordMaterial,
  FormMaterial,
  AppointmentMaterial,
];

export const materialMap: Record<string, MaterialDefinition> = Object.fromEntries(
  materials.map((m) => [m.meta.name, m as MaterialDefinition]),
);

/** 渲染器递归渲染时按 resolvedName 查这张表 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const componentMap: Record<string, ComponentType<any>> = Object.fromEntries(
  materials.map((m) => [m.meta.name, m.Component]),
);

/** 设计器工具箱数据源 */
export const materialMetas: MaterialMeta[] = materials.map((m) => m.meta);

/** 传给 validateFinalDsl，拦截引用了未注册物料的 DSL */
export const knownMaterialNames: ReadonlySet<string> = new Set(materials.map((m) => m.meta.name));

export function getMaterial(name: string): MaterialDefinition | undefined {
  return materialMap[name];
}
