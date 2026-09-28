'use strict';

// 给 refresh_tokens 补 user_agent 列。
//
// 背景（凭据维度太弱）：会话列表要区分设备，但此前只有 device_type /
// device_name —— 两者都是**客户端自报**的请求头，可任意伪造。UA 由运行环境
// 注入，至少不可由页面脚本随意改写，是比它俩更可信的一维。同时把
// `ip_address`（该列一直存在但**全仓从未写入过**）接上写入点。
//
// 为什么必须写迁移：这张表**从来没有迁移过** —— 它完全由 synchronize:true
// 建出来。sync 不会给已存在的表加列，所以列只能由本迁移补。
//
// 幂等三段式：
//   1. 表不存在（全新库）→ 跳过：模型里已带 user_agent，sync 按模型建全表；
//   2. 列已存在 → 跳过（sync 先建过，或本迁移跑过）；
//   3. 否则加列。
//
// ⚠️ 将来若给 refresh_tokens 再加列，**必须**另写迁移：sync 不会补列。
const { DataTypes } = require('sequelize');

const TABLE = 'refresh_tokens';
const COLUMN = 'user_agent';

async function tableExists(queryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
  return names.includes(TABLE);
}

module.exports = {
  async up(queryInterface) {
    if (!(await tableExists(queryInterface))) {
      return; // 全新库：模型里已带该列，sync 建表即完成
    }

    const columns = await queryInterface.describeTable(TABLE);
    if (columns[COLUMN]) {
      return; // 已存在
    }

    // 可空，且**没有回填**：历史会话没有留下 UA，编不出来。
    // 可空的语义是诚实的 —— 它表示「这条会话创建于本列存在之前」。
    await queryInterface.addColumn(TABLE, COLUMN, {
      type: DataTypes.STRING(512),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface))) {
      return;
    }
    const columns = await queryInterface.describeTable(TABLE);
    if (columns[COLUMN]) {
      await queryInterface.removeColumn(TABLE, COLUMN);
    }
  },
};
