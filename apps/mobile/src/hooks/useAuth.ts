import { useEffect } from "react";
import Taro from "@tarojs/taro";
import { getToken } from "@/utils/auth";

export const useAuth = () => {
  useEffect(() => {
    const checkAuth = async () => {
      const token = await getToken();

      if (!token) {
        Taro.reLaunch({
          url: "/pages/login/index",
        });
      }
    };

    checkAuth();
  }, []);
};