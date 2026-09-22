'use strict';

// 分析结果表格的持久化表。
//
// 背景：表格此前从未随正文落库 —— `getDetail` 两处硬编码 `tables: []`，
// 注释写着 "tables are stored inside result.content as markdown"。
// 结果是「实时流里能看到表格、重开详情页就没了」，而阶段二的附着/重放
// 正好建立在这条读路径上。
//
// 为什么还是「新建表」而不是给 analysis_results 加 JSON 列：
//   与 `20260921000000-create-analysis-tasks.js` 同一个理由 ——
//   `synchronize: true` 会自动创建**不存在的表**，但**不会**给已存在的表加列。
//   新表对任何环境都安全：即使有人忘了跑迁移，sync 也会把它建好，
//   本迁移退化为幂等的记账。形态与既有的 analysis_charts 对齐。
//
// ⚠️ 将来若给 analysis_tables 加列，**必须**另写迁移：sync 不会补列。
const { DataTypes } = require('sequelize');

const TABLE = 'analysis_tables';

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
      analysis_id: {
        type: DataTypes.STRING(36),
        allowNull: false,
        references: { model: 'analysis_sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // 整份 TableConfig（id/title/columns/data）原样存 JSON，
      // 与 analysis_charts.chart_config 同构
      table_config: { type: DataTypes.JSON, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex(TABLE, ['analysis_id'], {
      name: 'idx_analysis_tables_analysis',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE);
  },
};
