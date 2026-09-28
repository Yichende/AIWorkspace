'use strict';

// 给 analysis_files 补归属列。
//
// 背景（越权）：`fileId` 是客户端自报的自增整数，`createSession` 此前直接
// `findByPk` 就把 analysis_id 挂上去，**不校验归属** —— 任何登录用户都能拿
// 别人的 fileId 建立分析会话。根因是这张表压根没有「谁传的」这一列，
// 上传路径也从未记录过上传者。
//
// 为什么必须写迁移（而不是靠 synchronize）：sync 只会 CREATE TABLE IF NOT EXISTS，
// **不会**给已存在的表加列 —— 与 20260921000000 / 20260922000000 同一个理由。
//
// 幂等三段式：
//   1. 表不存在（全新库）→ 跳过：模型里已带 user_id，sync 按模型建全表即完成；
//   2. 列已存在（sync 或本迁移之前建过）→ 跳过；
//   3. 否则加列 + 回填。
//
// ⚠️ 将来若给 analysis_files 再加列，**必须**另写迁移：sync 不会补列。
const { DataTypes } = require('sequelize');

const TABLE = 'analysis_files';
const COLUMN = 'user_id';

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

    // 可空：存量行无法凭空得知归属（新行由 saveFileRecord 保证非空）。
    // 用 allowNull 而不是给个假值 —— 假值会变成「归属到错误的人」，
    // 比 NULL 危险得多。
    await queryInterface.addColumn(TABLE, COLUMN, {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // 回填：已关联过会话的文件，归属可以从 analysis_sessions.user_id 反推。
    //
    // 多 JOIN 一张 users 是防御性的：写进一个不存在的 user_id 会撞上刚加的
    // FK 约束、导致整个迁移失败。实测确认 analysis_sessions.user_id 本身就
    // 带 FK 指向 users，所以「会话属主不存在」这一情形**当前构造不出来** ——
    // 这个 JOIN 是为将来那张 FK 被去掉的情况留的保险，不增加任何成本。
    //
    // WHERE f.user_id IS NULL 保证不会覆盖已有归属（幂等重跑的前提）。
    //
    // 仍未关联会话的文件（analysis_id IS NULL，即传了但从未分析）保持 NULL。
    // 那些文件此后任何人都关联不上（userId 为 null 永远不等于真实 userId），
    // 用户会看到「请重新上传」。这是**刻意的 fail-closed**：放行 NULL 归属
    // 就等于让存量行继续可越权。影响面被 24h 的 expire_at 与每小时清理
    // 自然收敛。
    await queryInterface.sequelize.query(
      `UPDATE ${TABLE} f
         JOIN analysis_sessions s ON s.id = f.analysis_id
         JOIN users u ON u.id = s.user_id
          SET f.user_id = s.user_id
        WHERE f.user_id IS NULL`,
    );
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
