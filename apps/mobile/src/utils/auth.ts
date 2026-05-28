import Taro from "@tarojs/taro";

const TOKEN_KEY = "ACCESS_TOKEN";

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