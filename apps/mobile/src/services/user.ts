import Taro from "@tarojs/taro";
import { getToken, getRefreshToken, setToken, setRefreshToken } from "@/utils/auth";
import { isTokenExpiringSoon } from "@/utils/token-check";
import { useUserStore } from "@/stores/user.store";
import request from "./request";

const BASE_URL = "http://localhost:3000";

/** 服务端只存相对路径（/uploads/avatar/xxx.jpg），此处转换为完整 URL */
export const resolveAvatar = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/")) return `${BASE_URL}${path}`;
  return path;
};

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

/** 服务端 user 统一结构（登录/注册/微信登录/档案），不含 openid */
interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  avatar?: string | null;
  /** 微信是否已绑定（服务端判定） */
  wechat_bound: boolean;
  /** 是否已设置密码（false = 微信账号，可用「设置密码」补齐） */
  has_password: boolean;
}

interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

/** 服务端 user/profile → store UserInfo（avatar 相对路径转完整 URL） */
export const profileToUserInfo = (p: AuthUser) => ({
  id: p.id,
  username: p.username,
  email: p.email,
  avatar: resolveAvatar(p.avatar),
  wechatBound: p.wechat_bound,
  hasPassword: p.has_password,
});

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

/** 微信一键登录（小程序 code；H5 请用「请在微信小程序中使用」拦截） */
export const wechatLoginApi = (data: { code: string }) => {
  return request<LoginResult>({
    url: "/auth/wechat/login",
    method: "POST",
    data,
  });
};

/** 绑定微信到当前登录账号 */
export const wechatBindApi = (data: { code: string }) => {
  return request<{ success: boolean; wechat_bound: boolean }>({
    url: "/auth/wechat/bind",
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

export interface ProfileResult extends AuthUser {}

/** 获取当前用户资料（GET /user/profile, Bearer） */
export const getProfileApi = () => {
  return request<ProfileResult>({
    url: "/user/profile",
    method: "GET",
  });
};

/** 更新用户资料（PATCH /user/profile） */
export const updateProfileApi = (data: {
  username?: string;
  avatar?: string;
}) => {
  return request<ProfileResult>({
    url: "/user/profile",
    method: "PATCH",
    data,
  });
};

/** 修改密码（成功后服务端已撤销全部 refresh token，需重新登录） */
export const changePasswordApi = (data: {
  oldPassword: string;
  newPassword: string;
}) => {
  return request<{ success: boolean }>({
    url: "/auth/change-password",
    method: "POST",
    data,
  });
};

/** 设置密码（仅无密码的微信账号可用，成功后保持登录不重登） */
export const setPasswordApi = (data: { newPassword: string }) => {
  return request<{ success: boolean }>({
    url: "/auth/set-password",
    method: "POST",
    data,
  });
};

/** 上传头像（返回相对 URL /uploads/avatar/xxx.jpg） */
export const uploadAvatarApi = (filePath: string): Promise<{ url: string }> => {
  return new Promise(async (resolve, reject) => {
    let token: string | null =
      useUserStore.getState().token || (await getToken());

    // Pre-check: refresh token if expiring soon
    if (token && isTokenExpiringSoon(token, 30000)) {
      try {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          const refreshRes = await Taro.request<{
            access_token: string;
            refresh_token: string;
          }>({
            url: `${BASE_URL}/auth/refresh`,
            method: "POST",
            data: { refresh_token: refreshToken },
            header: { "Content-Type": "application/json" },
          });

          if (
            refreshRes.statusCode >= 200 &&
            refreshRes.statusCode < 300
          ) {
            const { access_token, refresh_token } = refreshRes.data;
            await setToken(access_token);
            await setRefreshToken(refresh_token);
            useUserStore.getState().setToken(access_token);
            useUserStore.getState().setRefreshToken(refresh_token);
            token = access_token;
          }
        }
      } catch {
        // Refresh failed — proceed with existing token (will 401 if expired)
      }
    }

    Taro.uploadFile({
      url: `${BASE_URL}/upload/avatar`,
      filePath,
      name: "file",
      header: {
        Authorization: token ? `Bearer ${token}` : "",
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(res.data);
            resolve(data);
          } catch {
            reject(new Error("上传响应解析失败"));
          }
        } else {
          reject(new Error(res.data || "上传失败"));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || "上传失败"));
      },
    });
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
