/**
 * Navigation param lists.
 *
 * Declared in one file so a screen's props are typed from the same definition the
 * navigator is built from. A screen's `route.params` is then checked at compile time
 * — the alternative is a runtime `undefined` on the one screen that forgot a param.
 */

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  /** Prefilled after registration, so the user does not retype their address. */
  Otp: { identifier: string } | undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Account: undefined;
};
