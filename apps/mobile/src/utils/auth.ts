import Taro from "@tarojs/taro";

const TOKEN_KEY = "ACCESS_TOKEN";
const REFRESH_TOKEN_KEY = "REFRESH_TOKEN";

// ── Access Token ──────────────────────────────────────────────

export const getToken = async () => {
  return await Taro.getStorage({
    key: TOKEN_KEY,
  })
    .then((res) => res.data || "")
    .catch(() => "");
};

export const setToken = async (token: string) => {
  await Taro.setStorage({
    key: TOKEN_KEY,
    data: token,
  });
};

export const removeToken = async () => {
  await Taro.removeStorage({
    key: TOKEN_KEY,
  });
};

// ── Refresh Token ─────────────────────────────────────────────

export const getRefreshToken = async () => {
  return await Taro.getStorage({
    key: REFRESH_TOKEN_KEY,
  })
    .then((res) => res.data || "")
    .catch(() => "");
};

export const setRefreshToken = async (token: string) => {
  await Taro.setStorage({
    key: REFRESH_TOKEN_KEY,
    data: token,
  });
};

export const removeRefreshToken = async () => {
  await Taro.removeStorage({
    key: REFRESH_TOKEN_KEY,
  });
};

// ── Bulk clear ────────────────────────────────────────────────

export const clearAllAuth = async () => {
  await removeToken();
  await removeRefreshToken();
};
