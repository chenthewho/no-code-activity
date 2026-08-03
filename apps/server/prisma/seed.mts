/**
 * 初始化脚本（可重复执行）。
 * 关键职责之一：把代码里 @nca/materials 的物料元信息同步进 material 表——
 * 注册表与实现同源，工具箱不会出现「能拖但渲染不出来」的物料。
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION } from '@nca/shared';
import { materialMetas } from '@nca/materials';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const PERMISSION_META: Record<string, { name: string; module: string }> = {
  [PERMISSION.ACTIVITY_VIEW]: { name: '查看活动', module: 'activity' },
  [PERMISSION.ACTIVITY_EDIT]: { name: '编辑活动', module: 'activity' },
  [PERMISSION.ACTIVITY_PUBLISH]: { name: '发布活动', module: 'activity' },
  [PERMISSION.ACTIVITY_DELETE]: { name: '删除活动', module: 'activity' },
  [PERMISSION.TEMPLATE_VIEW]: { name: '查看模板', module: 'template' },
  [PERMISSION.TEMPLATE_MANAGE]: { name: '管理模板', module: 'template' },
  [PERMISSION.MATERIAL_MANAGE]: { name: '管理物料', module: 'material' },
  [PERMISSION.AI_USE]: { name: '使用 AI 助手', module: 'ai' },
  [PERMISSION.AI_PUBLISH]: { name: 'AI 发起发布', module: 'ai' },
  [PERMISSION.SYSTEM_MANAGE]: { name: '系统管理', module: 'system' },
};

const ROLES = [
  {
    code: 'admin',
    name: '管理员',
    permissions: Object.keys(PERMISSION_META),
  },
  {
    code: 'operator',
    name: '运营',
    permissions: [
      PERMISSION.ACTIVITY_VIEW,
      PERMISSION.ACTIVITY_EDIT,
      PERMISSION.ACTIVITY_PUBLISH,
      PERMISSION.TEMPLATE_VIEW,
      PERMISSION.AI_USE,
      PERMISSION.AI_PUBLISH,
    ] as string[],
  },
  {
    code: 'viewer',
    name: '只读',
    permissions: [PERMISSION.ACTIVITY_VIEW, PERMISSION.TEMPLATE_VIEW] as string[],
  },
];

async function seedPermissions() {
  for (const [code, meta] of Object.entries(PERMISSION_META)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, name: meta.name, module: meta.module },
      update: { name: meta.name, module: meta.module },
    });
  }
  console.log(`✓ 权限 ${Object.keys(PERMISSION_META).length} 项`);
}

async function seedRoles() {
  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name },
      update: { name: role.name },
    });

    const permissions = await prisma.permission.findMany({
      where: { code: { in: role.permissions } },
      select: { id: true },
    });

    // 全量重建角色权限，保证删掉的权限真的会被收回
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: saved.id, permissionId: p.id })),
    });
  }
  console.log(`✓ 角色 ${ROLES.length} 个`);
}

async function seedAdminUser() {
  const username = 'admin';
  const password = await argon2.hash('admin123');

  const user = await prisma.user.upsert({
    where: { username },
    create: { username, password, nickname: '超级管理员' },
    update: {},
  });

  const adminRole = await prisma.role.findUnique({ where: { code: 'admin' } });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      create: { userId: user.id, roleId: adminRole.id },
      update: {},
    });
  }
  console.log('✓ 管理员账号 admin / admin123（请在生产环境立即修改）');
}

async function seedMaterials() {
  for (const [index, meta] of materialMetas.entries()) {
    await prisma.material.upsert({
      where: { name: meta.name },
      create: {
        name: meta.name,
        version: meta.version,
        title: meta.title,
        category: meta.category,
        meta: meta as unknown as object,
        sort: index,
      },
      update: {
        version: meta.version,
        title: meta.title,
        category: meta.category,
        meta: meta as unknown as object,
        sort: index,
      },
    });
  }
  console.log(`✓ 物料注册表同步 ${materialMetas.length} 个`);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedAdminUser();
  await seedMaterials();
}

main()
  .catch((err) => {
    console.error('seed 失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
