import { create } from "zustand";

interface UserInfo {
  id: string;
  username: string;
}

interface UserState {
  token: string;
  userInfo: UserInfo | null;

  setToken: (token: string) => void;
  setUserInfo: (userInfo: UserInfo | null) => void;

  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  token: "",
  userInfo: null,

  setToken: (token) => set({ token }),

  setUserInfo: (userInfo) => set({ userInfo }),

  logout: () =>
    set({
      token: "",
      userInfo: null,
    }),
}));