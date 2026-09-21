import Taro from "@tarojs/taro";
import { getToken, clearAllAuth } from "@/utils/auth";
import { useUserStore } from "@/stores/user.store";
import { API_BASE_URL as BASE_URL } from "@/config/env";
import { ApiError, ErrorKind, toApiError } from "@/utils/api-error";
import { refreshAccessToken } from "./token-refresh";

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
      // 此前没有 fail 回调，传输层失败会以 Taro 的 { errMsg } 形状直接逃逸
      // 出去，成为第 5 种错误形状。这里统一转成 ApiError。
      fail: (err) => {
        throw toApiError(err, "请求失败");
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
        // 顺序不变：先登出（触发 reLaunch），再 reject，
        // 保证跳转先于页面 toast 发生
        await forceLogout();
        return Promise.reject(
          new ApiError({
            kind: ErrorKind.Auth,
            status: 401,
            message: "登录已过期，请重新登录",
          }),
        );
      }

      const retryRes = await doRequest(newToken);
      if (retryRes.statusCode < 200 || retryRes.statusCode >= 300) {
        return Promise.reject(toApiError(retryRes.data, "请求失败"));
      }
      return retryRes.data as T;
    }

    // ── Non-2xx → reject（归一化为 ApiError）────────────────
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return Promise.reject(toApiError(res.data, "请求失败"));
    }

    return res.data as T;
  } catch (error) {
    // toApiError 幂等：已是 ApiError 的原样返回，不会丢 serverCode/raw
    return Promise.reject(toApiError(error, "请求失败"));
  }
};

export default request;
