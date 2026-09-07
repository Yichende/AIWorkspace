'use strict';

// 微信登录：users 表新增 openid（唯一、可空）；email / password 放宽为可空（微信用户无邮箱密码）
const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn('users', 'openid', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('users', ['openid'], {
      unique: true,
      name: 'uni_users_openid',
    });
    await queryInterface.changeColumn('users', 'email', {
      type: DataTypes.STRING(255),
      allowNull: true,
    });
    await queryInterface.changeColumn('users', 'password', {
      type: DataTypes.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'uni_users_openid');
    await queryInterface.removeColumn('users', 'openid');
    // email / password 不回退 NOT NULL：微信用户可能已写入 NULL 行，无法安全还原
  },
};
