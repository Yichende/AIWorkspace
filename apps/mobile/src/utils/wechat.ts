import Taro from "@tarojs/taro";
import { wechatBindApi } from "@/services/user";
import { useUserStore } from "@/stores/user.store";

/** 是否为微信小程序运行环境（Taro.login 仅该平台可用） */
export const isWeapp = () => process.env.TARO_ENV === "weapp";

/**
 * 获取微信登录临时凭证 code（wx.login 静默授权，无用户感知）。
 * 非小程序环境 reject「请在微信小程序中使用」，由调用方 toast。
 */
export const requestWechatCode = async (): Promise<string> => {
  if (!isWeapp()) {
    throw new Error("请在微信小程序中使用");
  }
  let res;
  try {
    res = await Taro.login();
  } catch (err: any) {
    throw new Error(err?.errMsg || "微信授权失败，请重试");
  }
  if (!res?.code) {
    throw new Error("获取微信登录凭证失败，请重试");
  }
  return res.code;
};

/**
 * 「绑定微信」点击流程（用户设置页 / 个人信息页共用）：
 * H5 → 提示；已绑定 → 提示；否则取 code 调绑定接口，
 * 成功就地更新 store（不跳页），两页绑定状态响应式刷新。
 */
export const bindWechatAndRefresh = async () => {
  if (!isWeapp()) {
    Taro.showToast({ title: "请在微信小程序中使用", icon: "none" });
    return;
  }
  if (useUserStore.getState().userInfo?.wechatBound) {
    Taro.showToast({ title: "当前账号已绑定微信", icon: "none" });
    return;
  }
  try {
    const code = await requestWechatCode();
    await wechatBindApi({ code });
    const cur = useUserStore.getState().userInfo;
    if (cur) {
      useUserStore.getState().setUserInfo({ ...cur, wechatBound: true });
    }
    Taro.showToast({ title: "绑定成功", icon: "success" });
  } catch (error: any) {
    const errMsg =
      typeof error === "string"
        ? error
        : error?.message || error?.errMsg || "绑定失败";
    Taro.showToast({ title: errMsg, icon: "none" });
  }
};
