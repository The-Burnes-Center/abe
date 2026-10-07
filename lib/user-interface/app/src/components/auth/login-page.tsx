/**
 * LoginPage -- branded, in-app authentication against Cognito.
 *
 * Rendered by AppConfigured when there is no active session. Talks to Cognito
 * directly through Amplify's SRP APIs, so users never see a hosted UI.
 *
 * Flows handled:
 *  - Sign in (email + password), including the follow-up challenges Cognito
 *    can return: "new password required" (invited users signing in with the
 *    temporary password from their invitation email), TOTP setup when the
 *    pool requires MFA, TOTP / email codes, and MFA method selection.
 *  - Self sign-up with email verification code, then automatic sign-in. Only
 *    offered when the deployment enables it (`selfSignUpEnabled` in
 *    aws-exports.json); otherwise the page explains that an administrator
 *    sends invitations.
 *  - Forgot password (reset code + new password).
 *
 * After sign-in the app renders at the URL the user originally opened. The
 * page never redirects elsewhere, so a post-login destination is always
 * same-origin.
 */
import { FormEvent, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import {
  signIn,
  signOut,
  confirmSignIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from "aws-amplify/auth";
import { brand } from "../../common/brand";
import { StorageHelper } from "../../common/helpers/storage-helper";
import { friendlyAuthError, passwordMeetsRules } from "./auth-helpers";
import PasswordChecklist from "./password-checklist";
import LoginBrandPanel from "./login-brand-panel";
import TotpSetupDetails from "./totp-setup";

interface LoginPageProps {
  /** Called once Cognito reports the sign-in is complete. */
  onSignedIn: () => void;
  /** Show the "Create an account" flow (deployment opted in to self sign-up). */
  selfSignUpEnabled?: boolean;
}

type View =
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "resetPassword"
  | "mfa"
  | "totpSetup"
  | "newPassword";

/**
 * Loose structural type for Amplify's sign-in `nextStep`, so this file keeps
 * compiling as Amplify adds new step literals to its unions.
 */
interface SignInNextStep {
  signInStep: string;
  codeDeliveryDetails?: { destination?: string; deliveryMedium?: string };
  totpSetupDetails?: {
    sharedSecret: string;
    getSetupUri: (appName: string, accountName?: string) => URL;
  };
  allowedMFATypes?: string[];
}

export default function LoginPage({ onSignedIn, selfSignUpEnabled = false }: LoginPageProps) {
  const theme = useTheme();
  const mode = theme.palette.mode;

  const [view, setView] = useState<View>("signIn");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaHint, setMfaHint] = useState("");
  const [totp, setTotp] = useState<{ uri: string; secret: string } | null>(null);

  const username = email.trim().toLowerCase();

  const goTo = (next: View, opts?: { clearPasswords?: boolean }) => {
    setError("");
    setInfo("");
    setCode("");
    setShowPassword(false);
    if (opts?.clearPasswords) {
      setPassword("");
      setConfirmPassword("");
    }
    setView(next);
  };

  const onToggleTheme = () => {
    StorageHelper.applyTheme(mode === "dark" ? "light" : "dark");
  };

  /** Route Cognito's post-sign-in challenge to the matching view. */
  const handleSignInStep = async (nextStep: SignInNextStep): Promise<void> => {
    const step = nextStep.signInStep;
    switch (step) {
      case "DONE":
        onSignedIn();
        return;
      case "CONFIRM_SIGN_UP":
        try {
          await resendSignUpCode({ username });
        } catch {
          // Best effort; the previous code may still be valid.
        }
        goTo("confirmSignUp");
        setInfo("This account still needs verification. We emailed you a code.");
        return;
      case "RESET_PASSWORD":
        await resetPassword({ username });
        goTo("resetPassword", { clearPasswords: true });
        setInfo("A password reset is required. We emailed you a code.");
        return;
      case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
        goTo("newPassword", { clearPasswords: true });
        return;
      case "CONTINUE_SIGN_IN_WITH_TOTP_SETUP": {
        const details = nextStep.totpSetupDetails;
        if (!details) break;
        setTotp({
          uri: details.getSetupUri(brand.assistantName, username).toString(),
          secret: details.sharedSecret,
        });
        goTo("totpSetup");
        return;
      }
      case "CONTINUE_SIGN_IN_WITH_MFA_SELECTION":
      case "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION": {
        // Authenticator apps are the supported method; pick TOTP when offered.
        const allowed = nextStep.allowedMFATypes ?? [];
        const choice = allowed.includes("TOTP") ? "TOTP" : undefined;
        if (!choice) break;
        const { nextStep: following } = await confirmSignIn({ challengeResponse: choice });
        await handleSignInStep(following as SignInNextStep);
        return;
      }
      case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
        setMfaHint("Enter the 6-digit code from your authenticator app.");
        goTo("mfa");
        return;
      case "CONFIRM_SIGN_IN_WITH_EMAIL_CODE":
        setMfaHint(
          `We sent a code to ${nextStep.codeDeliveryDetails?.destination ?? "your email"}.`
        );
        goTo("mfa");
        return;
    }
    setError(
      `This account requires a sign-in step this app doesn't support. Please contact ${brand.supportContact}.`
    );
  };

  /** Wrap a submit handler with shared busy/error handling. */
  const submit =
    (action: () => Promise<void>) => async (event: FormEvent) => {
      event.preventDefault();
      setError("");
      setInfo("");
      setBusy(true);
      try {
        await action();
      } catch (err) {
        setError(friendlyAuthError(err));
      } finally {
        setBusy(false);
      }
    };

  const handleSignIn = submit(async () => {
    // Drop any half-finished or stale local session first, so a leftover
    // token from another user can never be picked up instead of this sign-in.
    await signOut().catch(() => undefined);
    const { nextStep } = await signIn({ username, password });
    await handleSignInStep(nextStep as SignInNextStep);
  });

  const finishAutoSignIn = async () => {
    try {
      const { nextStep } = await autoSignIn();
      await handleSignInStep(nextStep as SignInNextStep);
    } catch {
      goTo("signIn", { clearPasswords: true });
      setInfo("Your email is verified. Sign in with your new account.");
    }
  };

  const handleSignUp = submit(async () => {
    if (!passwordMeetsRules(password)) {
      setError("Your password doesn't meet all the requirements yet.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
      return;
    }
    const name = fullName.trim();
    const { nextStep } = await signUp({
      username,
      password,
      options: {
        userAttributes: { email: username, ...(name ? { name } : {}) },
        autoSignIn: true,
      },
    });
    if (nextStep.signUpStep === "CONFIRM_SIGN_UP") {
      goTo("confirmSignUp");
      setInfo(`We sent a verification code to ${username}.`);
    } else if (nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
      await finishAutoSignIn();
    } else {
      goTo("signIn", { clearPasswords: true });
      setInfo("Account created. Sign in to continue.");
    }
  });

  const handleConfirmSignUp = submit(async () => {
    const { nextStep } = await confirmSignUp({
      username,
      confirmationCode: code.trim(),
    });
    if (nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
      await finishAutoSignIn();
    } else {
      goTo("signIn", { clearPasswords: true });
      setInfo("Your email is verified. Sign in with your new account.");
    }
  });

  const handleResendCode = async () => {
    setError("");
    try {
      await resendSignUpCode({ username });
      setInfo(`We sent a new code to ${username}.`);
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  };

  const handleForgotPassword = submit(async () => {
    const { nextStep } = await resetPassword({ username });
    if (nextStep.resetPasswordStep === "CONFIRM_RESET_PASSWORD_WITH_CODE") {
      goTo("resetPassword", { clearPasswords: true });
      setInfo(
        `We sent a code to ${nextStep.codeDeliveryDetails?.destination ?? "your email"}.`
      );
    } else {
      goTo("signIn", { clearPasswords: true });
    }
  });

  const handleConfirmReset = submit(async () => {
    if (!passwordMeetsRules(password)) {
      setError("Your new password doesn't meet all the requirements yet.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
      return;
    }
    await confirmResetPassword({
      username,
      confirmationCode: code.trim(),
      newPassword: password,
    });
    goTo("signIn", { clearPasswords: true });
    setInfo("Password updated. Sign in with your new password.");
  });

  /** Shared by the code challenge and the TOTP setup step. */
  const handleCode = submit(async () => {
    const { nextStep } = await confirmSignIn({ challengeResponse: code.trim() });
    await handleSignInStep(nextStep as SignInNextStep);
  });

  const handleNewPassword = submit(async () => {
    if (!passwordMeetsRules(password)) {
      setError("Your new password doesn't meet all the requirements yet.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
      return;
    }
    const { nextStep } = await confirmSignIn({ challengeResponse: password });
    await handleSignInStep(nextStep as SignInNextStep);
  });

  // ---------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------

  const passwordAdornment = (
    <InputAdornment position="end">
      <IconButton
        aria-label={showPassword ? "Hide password" : "Show password"}
        onClick={() => setShowPassword((v) => !v)}
        edge="end"
        size="small"
      >
        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
      </IconButton>
    </InputAdornment>
  );

  const emailField = (props?: { autoFocus?: boolean }) => (
    <TextField
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      autoComplete="email"
      required
      fullWidth
      autoFocus={props?.autoFocus}
      disabled={busy}
    />
  );

  const codeField = (label = "Verification code") => (
    <TextField
      label={label}
      value={code}
      onChange={(e) => setCode(e.target.value)}
      autoComplete="one-time-code"
      inputProps={{ inputMode: "numeric" }}
      required
      fullWidth
      autoFocus
      disabled={busy}
    />
  );

  const newPasswordFields = (
    <>
      <TextField
        label="New password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={busy}
        InputProps={{ endAdornment: passwordAdornment }}
      />
      <PasswordChecklist value={password} />
      <TextField
        label="Confirm password"
        type={showPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        autoComplete="new-password"
        required
        fullWidth
        disabled={busy}
        error={confirmPassword.length > 0 && confirmPassword !== password}
        helperText={
          confirmPassword.length > 0 && confirmPassword !== password
            ? "Passwords don't match"
            : " "
        }
      />
    </>
  );

  const submitButton = (label: string) => (
    <Button
      type="submit"
      variant="contained"
      size="large"
      fullWidth
      disabled={busy}
      sx={{ py: 1.4, fontWeight: 700, fontSize: "0.95rem" }}
    >
      {busy ? <CircularProgress size={22} sx={{ color: "inherit" }} /> : label}
    </Button>
  );

  const backToSignIn = (
    <Button
      onClick={() => goTo("signIn", { clearPasswords: true })}
      startIcon={<ArrowBackRoundedIcon />}
      size="small"
      sx={{ alignSelf: "flex-start", textTransform: "none", color: "text.secondary" }}
    >
      Back to sign in
    </Button>
  );

  const heading = (title: string, subtitle: string) => (
    <Box>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.75, color: "text.secondary" }}>{subtitle}</Typography>
    </Box>
  );

  const alerts = (
    <Box aria-live="polite">
      <Stack spacing={1.5}>
        {info && <Alert severity="success">{info}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  );

  const accountFooter = selfSignUpEnabled ? (
    <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary" }}>
      New here?{" "}
      <Link
        component="button"
        type="button"
        onClick={() => goTo("signUp", { clearPasswords: true })}
        sx={{ fontWeight: 600 }}
      >
        Create an account
      </Link>
    </Typography>
  ) : (
    <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary" }}>
      Accounts are created by invitation. Ask {brand.supportContact} to invite you, then sign in
      with the temporary password from your invitation email.
    </Typography>
  );

  // ---------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------

  let content: JSX.Element;
  switch (view) {
    case "signUp":
      content = (
        <Stack component="form" onSubmit={handleSignUp} spacing={2.25} noValidate>
          {heading("Create your account", "It only takes a minute to get started.")}
          {alerts}
          <TextField
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            fullWidth
            autoFocus
            disabled={busy}
          />
          {emailField()}
          {newPasswordFields}
          {submitButton("Create account")}
          <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary" }}>
            Already have an account?{" "}
            <Link
              component="button"
              type="button"
              onClick={() => goTo("signIn", { clearPasswords: true })}
              sx={{ fontWeight: 600 }}
            >
              Sign in
            </Link>
          </Typography>
        </Stack>
      );
      break;

    case "confirmSignUp":
      content = (
        <Stack component="form" onSubmit={handleConfirmSignUp} spacing={2.25} noValidate>
          {heading("Check your email", `Enter the verification code we sent to ${username}.`)}
          {alerts}
          {codeField()}
          {submitButton("Verify email")}
          <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary" }}>
            Didn't get it?{" "}
            <Link component="button" type="button" onClick={handleResendCode} sx={{ fontWeight: 600 }}>
              Resend code
            </Link>
          </Typography>
          {backToSignIn}
        </Stack>
      );
      break;

    case "forgotPassword":
      content = (
        <Stack component="form" onSubmit={handleForgotPassword} spacing={2.25} noValidate>
          {heading("Reset your password", "Enter your account email and we'll send you a reset code.")}
          {alerts}
          {emailField({ autoFocus: true })}
          {submitButton("Send reset code")}
          {backToSignIn}
        </Stack>
      );
      break;

    case "resetPassword":
      content = (
        <Stack component="form" onSubmit={handleConfirmReset} spacing={2.25} noValidate>
          {heading("Choose a new password", `Enter the code we sent to ${username} and pick a new password.`)}
          {alerts}
          {codeField("Reset code")}
          {newPasswordFields}
          {submitButton("Update password")}
          {backToSignIn}
        </Stack>
      );
      break;

    case "mfa":
      content = (
        <Stack component="form" onSubmit={handleCode} spacing={2.25} noValidate>
          {heading("Two-step verification", mfaHint || "Enter your verification code.")}
          {alerts}
          {codeField()}
          {submitButton("Verify")}
          {backToSignIn}
        </Stack>
      );
      break;

    case "totpSetup":
      content = (
        <Stack component="form" onSubmit={handleCode} spacing={2.25} noValidate>
          {heading(
            "Set up two-step verification",
            "Scan this QR code with an authenticator app (such as Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows."
          )}
          {alerts}
          {totp && <TotpSetupDetails setupUri={totp.uri} sharedSecret={totp.secret} />}
          {codeField("6-digit code")}
          {submitButton("Verify and continue")}
          {backToSignIn}
        </Stack>
      );
      break;

    case "newPassword":
      content = (
        <Stack component="form" onSubmit={handleNewPassword} spacing={2.25} noValidate>
          {heading("Set a new password", "Your account requires a new password before continuing.")}
          {alerts}
          {newPasswordFields}
          {submitButton("Save and continue")}
          {backToSignIn}
        </Stack>
      );
      break;

    default:
      content = (
        <Stack component="form" onSubmit={handleSignIn} spacing={2.25} noValidate>
          {heading("Welcome back", "Sign in to your account to continue.")}
          {alerts}
          {emailField({ autoFocus: true })}
          <Box>
            <TextField
              label="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              fullWidth
              disabled={busy}
              InputProps={{ endAdornment: passwordAdornment }}
            />
            <Box sx={{ mt: 1, textAlign: "right" }}>
              <Link
                component="button"
                type="button"
                onClick={() => goTo("forgotPassword", { clearPasswords: true })}
                variant="body2"
                sx={{ fontWeight: 600 }}
              >
                Forgot password?
              </Link>
            </Box>
          </Box>
          {submitButton("Sign in")}
          {accountFooter}
        </Stack>
      );
  }

  // ---------------------------------------------------------------------
  // Page layout
  // ---------------------------------------------------------------------

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", bgcolor: "background.default" }}>
      <LoginBrandPanel />

      {/* Form panel */}
      <Box
        sx={{
          flex: "1 1 45%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          px: { xs: 2, sm: 6 },
          py: { xs: 5, sm: 8 },
        }}
      >
        <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          <IconButton
            onClick={onToggleTheme}
            aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            sx={{ position: "absolute", top: 16, right: 16, color: "text.secondary" }}
          >
            {mode === "dark" ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
          </IconButton>
        </Tooltip>

        <Box sx={{ width: "100%", maxWidth: 400 }}>
          {/* Mobile-only identity (the brand panel is hidden below md) */}
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ mb: 4, display: { xs: "flex", md: "none" } }}
          >
            <Box component="img" src={brand.assets.icon} alt="" sx={{ height: 40, width: 40 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                {brand.assistantName}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {brand.organizationName}
              </Typography>
            </Box>
          </Stack>
          {content}
        </Box>

        <Typography
          variant="caption"
          sx={{ mt: 5, color: "text.secondary", display: { xs: "block", md: "none" } }}
        >
          © {new Date().getFullYear()} {brand.organizationName}
        </Typography>
      </Box>
    </Box>
  );
}
