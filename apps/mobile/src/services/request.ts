import Taro from "@tarojs/taro";
import {
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
  clearAllAuth,
} from "@/utils/auth";
import { useUserStore } from "@/stores/user.store";

interface RefreshResult {
  access_token: string;
  refresh_token: string;
}

const BASE_URL = "http://localhost:3000";

interface RequestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  data?: any;
  header?: Record<string, string>;
}

// ── Refresh lock to prevent concurrent refresh attempts ────────

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

// ── Raw refresh call — bypasses request() to avoid infinite loop ─

async function doRefreshToken(
  refreshToken: string
): Promise<RefreshResult> {
  const res = await Taro.request<RefreshResult>({
    url: `${BASE_URL}/auth/refresh`,
    method: "POST",
    data: { refresh_token: refreshToken },
    header: { "Content-Type": "application/json" },
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("刷新失败");
  }

  return res.data;
}

// ── Force logout ──────────────────────────────────────────────

async function forceLogout() {
  await clearAllAuth();
  useUserStore.getState().logout();
  Taro.reLaunch({ url: "/pages/login/index" });
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
      const refreshToken =
        useUserStore.getState().refreshToken || (await getRefreshToken());

      if (!refreshToken) {
        await forceLogout();
        return Promise.reject("登录失效");
      }

      // Another request is already refreshing — queue this one
      if (isRefreshing) {
        return new Promise<T>((resolve) => {
          addRefreshSubscriber(async (newToken: string) => {
            const retryRes = await doRequest(newToken);
            if (
              retryRes.statusCode < 200 ||
              retryRes.statusCode >= 300
            ) {
              return Promise.reject(retryRes.data);
            }
            resolve(retryRes.data as T);
          });
        });
      }

      // This request performs the refresh
      isRefreshing = true;

      try {
        const refreshRes = await doRefreshToken(refreshToken);
        const { access_token, refresh_token } = refreshRes;

        await setToken(access_token);
        await setRefreshToken(refresh_token);
        useUserStore.getState().setToken(access_token);
        useUserStore.getState().setRefreshToken(refresh_token);

        // Notify queued requests
        onRefreshed(access_token);
        isRefreshing = false;

        // Retry the original request with the new token
        const retryRes = await doRequest(access_token);
        if (retryRes.statusCode < 200 || retryRes.statusCode >= 300) {
          return Promise.reject(retryRes.data);
        }
        return retryRes.data as T;
      } catch {
        isRefreshing = false;
        refreshSubscribers = [];
        await forceLogout();
        return Promise.reject("登录失效");
      }
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
