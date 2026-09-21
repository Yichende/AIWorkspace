/**
 * 构建期环境配置（叶子模块）。
 *
 * 刻意不 import 任何 service：request.ts 与 token-refresh.ts 互相依赖，
 * token-refresh 曾因此把 BASE_URL 复制了一份（见其文件头注释）。把常量下沉到
 * 这个不依赖任何人的叶子模块，两边的环就不成立了。
 *
 * 注入方式只用 Taro 原生的 `.env.*` 机制（`TARO_APP_` 前缀的变量会被注入
 * `process.env`），**不额外配 defineConstants** —— 两套注入机制并存必然漂移。
 * 对应文件：apps/mobile/.env.development / .env.production / .env.test
 *
 * 注意注入发生在**构建期**：project.config.json 里 `es6:false`，开发者工具
 * 自己的转译管线是关的，运行时读 process.env 拿不到值。
 */
export const API_BASE_URL =
  process.env.TARO_APP_API_BASE || 'http://localhost:3000'
