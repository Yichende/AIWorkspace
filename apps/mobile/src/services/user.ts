import { API_BASE_URL as BASE_URL } from "@/config/env";
import { uploadWithAuth } from "@/utils/upload";
import request from "./request";

/** 形如 `http://host:port/uploads/avatar/x.jpg` 的绝对地址（用于归一化历史值） */
const ABSOLUTE_URL_RE = /^https?:\/\/[^/]+(\/.*)?$/i;

/**
 * 把服务端的头像路径转成可渲染的完整 URL（**渲染期**调用）。
 *
 * 终态约定：store 里存**相对路径**，host 只在渲染时拼接 —— 换域名时持久层
 * 不受影响。同时对历史/异常来源的绝对 URL 做兼容归一化：**重写其 host** 为
 * 当前 API_BASE_URL，而不是原样透传，避免指向已失效的旧地址。
 */
export function resolveAvatar(path: string): string;
export function resolveAvatar(path?: string | null): string | undefined;
export function resolveAvatar(path?: string | null): string | undefined {
  if (!path) return undefined;

  const absolute = path.match(ABSOLUTE_URL_RE);
  if (absolute) {
    // 已带 host：只保留其路径部分，改用当前 host
    return `${BASE_URL}${absolute[1] ?? ""}`;
  }

  if (path.startsWith("/")) return `${BASE_URL}${path}`;
  return path;
}

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

/**
 * 服务端 user/profile → store UserInfo。
 *
 * avatar 原样存**相对路径**（不在此拼 host）—— 渲染时由 resolveAvatar 拼接，
 * 这样换域名/换环境不需要迁移 store 里的数据。
 */
export const profileToUserInfo = (p: AuthUser) => ({
  id: p.id,
  username: p.username,
  email: p.email,
  avatar: p.avatar ?? undefined,
  wechatBound: p.wechat_bound,
  hasPassword: p.has_password,
});

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
export const uploadAvatarApi = (
  filePath: string
): Promise<{ url: string }> =>
  uploadWithAuth<{ url: string }>({
    url: `${BASE_URL}/upload/avatar`,
    filePath,
    name: "file",
  });

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
