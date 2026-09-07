'use strict';

// sequelize-cli 迁移配置：与 app.module.ts 同源读取 apps/server/.env
require('dotenv').config();

const common = {
  dialect: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  timezone: '+08:00',
  logging: false,
};

module.exports = {
  development: common,
  production: common,
};
