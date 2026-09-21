'use strict';

// 分析任务的执行记录（真队列化的基础表）。
//
// 为什么是「新建表」而不是给 analysis_sessions 加列：
//   `synchronize: true` 会自动创建**不存在的表**，但**不会**给已存在的表加列
//   （alter 默认关闭）。因此新表对任何环境都是安全的 —— 即使有人忘了跑迁移，
//   sync 也会把它建好，本迁移退化为幂等的记账。
//
// ⚠️ 将来若给 analysis_tasks 加列，**必须**另写迁移：sync 不会补列。
const { DataTypes } = require('sequelize');

const TABLE = 'analysis_tasks';

module.exports = {
  async up(queryInterface) {
    // 幂等：若 synchronize:true 已经建过表，直接跳过，避免两条路径互相踩
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (names.includes(TABLE)) {
      return;
    }

    await queryInterface.createTable(TABLE, {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      session_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
        references: { model: 'analysis_sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      state: {
        type: DataTypes.ENUM(
          'QUEUED',
          'RUNNING',
          'SUCCEEDED',
          'FAILED',
          'CANCELED',
        ),
        allowNull: false,
        defaultValue: 'QUEUED',
      },
      progress_stage: { type: DataTypes.STRING(20), allowNull: true },
      progress_percent: { type: DataTypes.INTEGER, allowNull: true },
      attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_by: { type: DataTypes.STRING(64), allowNull: true },
      locked_at: { type: DataTypes.DATE, allowNull: true },
      heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      error_message: { type: DataTypes.STRING(500), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex(TABLE, ['session_id'], {
      name: 'idx_analysis_tasks_session',
    });
    await queryInterface.addIndex(TABLE, ['state', 'created_at'], {
      name: 'idx_analysis_tasks_state_created',
    });
    await queryInterface.addIndex(TABLE, ['heartbeat_at'], {
      name: 'idx_analysis_tasks_heartbeat',
    });
  },

  async down(queryInterface) {
    // 阶段一不存值得保留的数据；阶段二上线后若已有历史任务，应先导出再 drop
    await queryInterface.dropTable(TABLE);
  },
};
