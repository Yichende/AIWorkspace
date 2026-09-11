import Taro from "@tarojs/taro";
import {
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
} from "@/utils/auth";
import { isTokenExpiringSoon } from "@/utils/token-check";
import { useUserStore } from "@/stores/user.store";

/** 本地常量：不要从 request.ts 导入，request.ts 反向依赖本模块，会成环 */
const BASE_URL = "http://localhost:3000";

/** 临期阈值：30 秒 */
const REFRESH_THRESHOLD_MS = 30000;

interface RefreshResult {
  access_token: string;
  refresh_token: string;
}

/** 单飞槽位：并发调用者共享同一个在途 Promise */
let refreshPromise: Promise<string> | null = null;

/** store 优先、storage 兜底 */
async function readAccessToken(): Promise<string> {
  return useUserStore.getState().token || (await getToken());
}

async function readRefreshToken(): Promise<string> {
  return useUserStore.getState().refreshToken || (await getRefreshToken());
}

/**
 * 刷新 access token，全局单飞。
 * - 成功：持久化 storage + store，resolve 新的 access_token
 * - 失败：reject，并在 finally 释放槽位以便后续重试
 * - 绝不登出、绝不跳转（登出策略属于 request.ts）
 *
 * ⚠️ 不要在参数里接收 refresh token：必须在工厂内部读取最新值。
 * 若由调用方传入，陈旧 RT 会被提交给服务端，触发重放检测
 * （auth.service.ts 的 record.destroy()）导致会话被销毁，单飞也救不回来。
 *
 * 注意本函数刻意不是 async：对 refreshPromise 的赋值必须同步完成，
 * 同一 tick 内的多个调用者才会共享同一次飞行。
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) {
        throw new Error("无刷新令牌");
      }

      const res = await Taro.request<RefreshResult>({
        url: `${BASE_URL}/auth/refresh`,
        method: "POST",
        data: { refresh_token: refreshToken },
        header: { "Content-Type": "application/json" },
      });

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("刷新失败");
      }

      const { access_token, refresh_token } = res.data;

      await setToken(access_token);
      await setRefreshToken(refresh_token);
      useUserStore.getState().setToken(access_token);
      useUserStore.getState().setRefreshToken(refresh_token);

      return access_token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * 请求前置路径：不临期则原样返回；临期则刷新。
 *
 * 刷新失败时吞掉错误并返回旧 token（保留原内联块 "proceed with existing
 * token" 的行为），绝不抛、绝不登出。
 * 这是契约而非防御性代码：useAnalysisStream 的流式调用是 fire-and-forget，
 * 若此处抛出会变成 unhandled rejection。
 */
export async function getValidAccessToken(): Promise<string> {
  const token = await readAccessToken();
  if (!token || !isTokenExpiringSoon(token, REFRESH_THRESHOLD_MS)) {
    return token;
  }
  try {
    return await refreshAccessToken();
  } catch {
    return token;
  }
}
