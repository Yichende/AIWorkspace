import Taro from "@tarojs/taro";
import { getToken, clearAllAuth } from "@/utils/auth";
import { useUserStore } from "@/stores/user.store";
import { refreshAccessToken } from "./token-refresh";

const BASE_URL = "http://localhost:3000";

interface RequestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  data?: any;
  header?: Record<string, string>;
}

// ── Force logout (idempotent) ─────────────────────────────────
// 多个并发请求可能同时刷新失败，共享同一个在途 Promise 会让它们在
// 同一批微任务里一起 reject。用单飞槽位把并发的登出收敛成一次，
// 避免连续多次 Taro.reLaunch。

let logoutPromise: Promise<void> | null = null;

function forceLogout(): Promise<void> {
  if (!logoutPromise) {
    logoutPromise = Promise.resolve()
      .then(async () => {
        await clearAllAuth();
        useUserStore.getState().logout();
        Taro.reLaunch({ url: "/pages/login/index" });
      })
      .catch(() => {
        // Taro.reLaunch 在导航失败时会 reject，登出本身已完成，忽略即可
      })
      .finally(() => {
        logoutPromise = null;
      });
  }
  return logoutPromise;
}

// ── Main request function ─────────────────────────────────────

const request = async <T>(options: RequestOptions): Promise<T> => {
  const token = useUserStore.getState().token || (await getToken());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doRequest = async (authToken: string): Promise<any> => {
    const res = await Taro.request<T>({
      url: `${BASE_URL}${options.url}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        ...options.header,
        Authorization: authToken ? `Bearer ${authToken}` : "",
      },
    });
    return res;
  };

  try {
    const res = await doRequest(token);

    // ── 401: attempt silent refresh ──────────────────────────
    if (res.statusCode === 401) {
      let newToken: string;

      try {
        // 单飞：并发的 401 共享同一次刷新；失败时所有等待者一起 reject
        newToken = await refreshAccessToken();
      } catch {
        await forceLogout();
        return Promise.reject("登录失效");
      }

      const retryRes = await doRequest(newToken);
      if (retryRes.statusCode < 200 || retryRes.statusCode >= 300) {
        return Promise.reject(retryRes.data);
      }
      return retryRes.data as T;
    }

    // ── Non-2xx → reject ─────────────────────────────────────
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return Promise.reject(res.data);
    }

    return res.data as T;
  } catch (error) {
    return Promise.reject(error);
  }
};

export default request;
