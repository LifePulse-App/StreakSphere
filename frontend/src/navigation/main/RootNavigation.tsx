import { createNavigationContainerRef } from '@react-navigation/native';
import UserStorage from '../../auth/user/UserStorage';
import sharedApi from '../../shared/services/shared-api';
import SavedAccountsStorage from "../../auth/user/SavedAccountsStorage";
import { disconnectSocket } from '../../auth/api-client/socket';

export const navigationRef = createNavigationContainerRef<any>();


export const resetToLogin = async () => {
  if (navigationRef.isReady()) {
    const saved = await SavedAccountsStorage.getAll();
    navigationRef.reset({
      index: 0,
      routes: [{ name: saved.length > 0 ? "SavedAccounts" : "Login" as never }],
    });
  }
};

export const logout = async (currentUserId: string) => {
  try {
    const refreshToken = await UserStorage.getRefreshToken();
    if (currentUserId && refreshToken) {
      await sharedApi.LogoutUser(currentUserId, refreshToken);
    }
    disconnectSocket()
    await UserStorage.clearTokens();
    await UserStorage.deleteUser();
    resetToLogin();
  } catch (err) {
    // console.log(err);
    await UserStorage.clearTokens();
    await UserStorage.deleteUser();
    resetToLogin();
  }
};