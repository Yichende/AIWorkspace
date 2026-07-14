import Taro from "@tarojs/taro";
import request from "./request";

const BASE_URL = "http://localhost:3000";

// ── Types ─────────────────────────────────────────────────────

interface LoginParams {
  email: string;
  password: string;
}

interface RegisterParams {
  username: string;
  email: string;
  password: string;
}

interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: {
    id: number;
    username: string;
    email: string;
  };
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
}

export interface SessionItem {
  id: number;
  device_type: string;
  device_name: string;
  device_id: string;
  ip_address: string;
  last_used_at: string;
  created_at: string;
  is_current: boolean;
}

// ── API calls that go through the request wrapper ──────────────

/** 登录 */
export const loginApi = (data: LoginParams) => {
  return request<LoginResult>({
    url: "/auth/login",
    method: "POST",
    data,
  });
};

/** 注册 */
export const registerApi = (data: RegisterParams) => {
  return request<LoginResult>({
    url: "/auth/register",
    method: "POST",
    data,
  });
};

/** 获取活跃设备列表 */
export const getSessionsApi = (deviceId?: string) => {
  return request<SessionItem[]>({
    url: `/auth/sessions${deviceId ? `?device_id=${deviceId}` : ""}`,
    method: "GET",
  });
};

/** 单设备登出 */
export const revokeSessionApi = (sessionId: number) => {
  return request<void>({
    url: `/auth/sessions/${sessionId}`,
    method: "DELETE",
  });
};

/** 全设备登出（except=current 排除当前设备） */
export const revokeAllSessionsApi = (exceptCurrent?: boolean) => {
  return request<void>({
    url: `/auth/sessions${exceptCurrent ? "?except=current" : ""}`,
    method: "DELETE",
  });
};

// ── Refresh token API — MUST bypass request() to avoid 401 loop ─

export const refreshTokenApi = async (
  refreshToken: string
): Promise<RefreshResult> => {
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
};
