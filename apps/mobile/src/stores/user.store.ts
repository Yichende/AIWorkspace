import { create } from "zustand";

interface UserInfo {
  /** 与后端保持一致：Sequelize 自增主键为 number */
  id: number;
  username: string;
  email?: string;
  avatar?: string;
}

interface UserState {
  token: string;
  refreshToken: string;
  userInfo: UserInfo | null;
  authReady: boolean;
  /** 模型 ID → 上次连接测试是否可用（前端内存缓存，不持久化） */
  modelTestResults: Record<string, boolean>;

  setToken: (token: string) => void;
  setRefreshToken: (refreshToken: string) => void;
  setUserInfo: (userInfo: UserInfo | null) => void;
  setAuthReady: () => void;
  setModelTestResult: (modelId: string, available: boolean) => void;

  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  token: "",
  refreshToken: "",
  userInfo: null,
  authReady: false,
  modelTestResults: {},

  setToken: (token) => set({ token }),

  setRefreshToken: (refreshToken) => set({ refreshToken }),

  setUserInfo: (userInfo) => set({ userInfo }),

  setAuthReady: () => set({ authReady: true }),

  setModelTestResult: (modelId, available) =>
    set((state) => ({
      modelTestResults: { ...state.modelTestResults, [modelId]: available },
    })),

  logout: () =>
    set({
      token: "",
      refreshToken: "",
      userInfo: null,
    }),
}));
