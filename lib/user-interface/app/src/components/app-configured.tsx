/**
 * AppConfigured -- Authentication gate and theme bootstrap for the app.
 *
 * This component controls the entire initialization sequence before the
 * main `<App />` tree is rendered:
 *
 *  1. **Fetch runtime config** -- loads `/aws-exports.json` (written at
 *     deploy time by CDK, or by the Vite dev plugin locally) to obtain the
 *     Cognito pool IDs, API endpoints and whether self sign-up is enabled.
 *  2. **Configure Amplify** -- passes the config to `Amplify.configure()`.
 *  3. **Check authentication** -- calls `getCurrentUser()`. With a valid
 *     session the app renders immediately; otherwise the branded in-app
 *     `LoginPage` is rendered at the current URL, so after signing in the
 *     user lands on the page they asked for.
 *  4. **Keep the session alive** -- when a backgrounded tab becomes visible
 *     again the session is refreshed, and a failed refresh sends the user
 *     back to sign-in instead of letting the next API call fail.
 *  5. **Theme detection** -- a `MutationObserver` watches the
 *     `--app-color-scheme` CSS variable on `<html>` and rebuilds the MUI
 *     theme when it flips between `"dark"` and `"light"`.
 */
import { useEffect, useState, useMemo } from "react";
import App from "../app";
import { Amplify, type ResourcesConfig } from "aws-amplify";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { AppConfig } from "../common/types";
import { Utils } from "../common/utils";
import { AppContext } from "../common/app-context";
import { StorageHelper, ThemeMode } from "../common/helpers/storage-helper";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { buildTheme } from "../common/theme";
import LoginPage from "./auth/login-page";

/** Map the on-disk `aws-exports.json` onto Amplify v6's `ResourcesConfig`. */
function toResourcesConfig(c: AppConfig): ResourcesConfig {
  return {
    Auth: {
      Cognito: {
        userPoolId: c.Auth.userPoolId,
        userPoolClientId: c.Auth.userPoolWebClientId ?? c.Auth.userPoolClientId ?? "",
        loginWith: { email: true },
      },
    },
  };
}

export default function AppConfigured() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>(StorageHelper.getTheme());

  const muiTheme = useMemo(() => buildTheme(theme), [theme]);

  useEffect(() => {
    (async () => {
      let awsExports: AppConfig;
      try {
        const result = await fetch("/aws-exports.json");
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        awsExports = (await result.json()) as AppConfig;
        Amplify.configure(toResourcesConfig(awsExports));
      } catch (err) {
        console.error("Could not load /aws-exports.json", err);
        setError(true);
        return;
      }
      try {
        await getCurrentUser();
        setAuthenticated(true);
      } catch {
        // No session: the render below shows the in-app login page.
        setAuthenticated(false);
      }
      setConfig(awsExports);
    })();
  }, []);

  /**
   * When a token can no longer be refreshed (expired or revoked), Amplify
   * emits `tokenRefresh_failure`. Send the user back to sign-in rather than
   * letting the next API call fail with a cryptic notification.
   */
  useEffect(() => {
    const stopListening = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "tokenRefresh_failure") {
        setAuthenticated(false);
        Utils.redirectToLogin();
      }
    });
    return stopListening;
  }, []);

  /**
   * Renew the session when a sleeping tab wakes up. Browsers throttle timers
   * in background tabs, so Amplify's refresh may not have run; refreshing on
   * visibility avoids a burst of 401s on the first click after returning.
   */
  useEffect(() => {
    if (!authenticated) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      fetchAuthSession()
        .then((session) => {
          if (!session.tokens?.idToken) Utils.redirectToLogin();
        })
        .catch(() => Utils.redirectToLogin());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authenticated]);

  /**
   * Theme detection via MutationObserver on `<html style="...">`. The
   * observer is re-created whenever `theme` changes so the closure always
   * compares against the latest value.
   */
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          const newValue =
            document.documentElement.style.getPropertyValue("--app-color-scheme");
          const mode: ThemeMode = newValue === "dark" ? "dark" : "light";
          if (mode !== theme) {
            setTheme(mode);
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });

    return () => {
      observer.disconnect();
    };
  }, [theme]);

  if (!config) {
    if (error) {
      return (
        <MuiThemeProvider theme={muiTheme}>
          <CssBaseline />
          <Box
            sx={{
              height: "100%",
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              p: 2,
            }}
          >
            <Alert severity="error" variant="filled">
              Error loading configuration from{" "}
              <a href="/aws-exports.json" style={{ fontWeight: 600, color: "inherit" }}>
                /aws-exports.json
              </a>
            </Alert>
          </Box>
        </MuiThemeProvider>
      );
    }

    return (
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box
          role="status"
          aria-live="polite"
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 1,
          }}
        >
          <CircularProgress size={20} aria-hidden="true" />
          Loading
        </Box>
      </MuiThemeProvider>
    );
  }

  return (
    <AppContext.Provider value={config}>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {authenticated ? (
          <App />
        ) : (
          <LoginPage
            selfSignUpEnabled={config.selfSignUpEnabled === true}
            onSignedIn={() => setAuthenticated(true)}
          />
        )}
      </MuiThemeProvider>
    </AppContext.Provider>
  );
}
