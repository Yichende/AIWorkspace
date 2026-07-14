import { create } from "zustand";

interface UserInfo {
  id: string;
  username: string;
  avatar?: string;
}

interface UserState {
  token: string;
  refreshToken: string;
  userInfo: UserInfo | null;

  setToken: (token: string) => void;
  setRefreshToken: (refreshToken: string) => void;
  setUserInfo: (userInfo: UserInfo | null) => void;

  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  token: "",
  refreshToken: "",
  userInfo: null,

  setToken: (token) => set({ token }),

  setRefreshToken: (refreshToken) => set({ refreshToken }),

  setUserInfo: (userInfo) => set({ userInfo }),

  logout: () =>
    set({
      token: "",
      refreshToken: "",
      userInfo: null,
    }),
}));
