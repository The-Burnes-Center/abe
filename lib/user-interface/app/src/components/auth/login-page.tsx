/**
 * LoginPage -- branded, in-app authentication for native (non-SSO) deployments.
 *
 * Rendered by AppConfigured when the deployment has no federated SSO provider
 * (aws-exports.json `federatedSignInProvider` is empty) and there is no active
 * session. Talks to Cognito directly through Amplify's SRP APIs, so the user
 * never sees the generic Cognito hosted UI.
 *
 * Flows handled:
 *  - Sign in (email + password), including the follow-up challenges Cognito
 *    can return: SMS / TOTP / email MFA codes and "new password required"
 *    (admin-created users signing in for the first time).
 *  - Self sign-up with email verification code, then automatic sign-in.
 *  - Forgot password (reset code + new password).
 *
 * Visual design follows the app theme (config/brand.ts): a brand panel on the
 * left (desktop only) and the form on the right. Light/dark mode both work and
 * can be toggled from the page itself.
 */
import { FormEvent, useMemo, useState } from "react";
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
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LibraryBooksOutlinedIcon from "@mui/icons-material/LibraryBooksOutlined";
import GppGoodOutlinedIcon from "@mui/icons-material/GppGoodOutlined";
import {
  signIn,
  confirmSignIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from "aws-amplify/auth";
import { brand } from "../../common/brand";
import { tokens } from "../../common/theme";
import { StorageHelper } from "../../common/helpers/storage-helper";

interface LoginPageProps {
  /** Called once Cognito reports the sign-in is complete. */
  onSignedIn: () => void;
}

type View =
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "forgotPassword"
  | "resetPassword"
  | "mfa"
  | "newPassword";

/**
 * Loose structural type for Amplify's sign-in `nextStep`, so this file keeps
 * compiling as Amplify adds new step literals to its unions.
 */
interface SignInNextStep {
  signInStep: string;
  codeDeliveryDetails?: { destination?: string; deliveryMedium?: string };
}

/** Mirrors the pool password policy in lib/authorization/index.ts. */
const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
  { label: "A symbol", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

const passwordMeetsRules = (p: string) =>
  PASSWORD_RULES.every((rule) => rule.test(p));

/** Map Cognito error codes onto messages a person can act on. */
function friendlyAuthError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as Error)?.message ?? "";
  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "UsernameExistsException":
      return "An account with this email already exists. Try signing in instead.";
    case "InvalidPasswordException":
      return "That password doesn't meet the requirements.";
    case "CodeMismatchException":
      return "That code doesn't match. Double-check it and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Request a new one and try again.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "UserNotConfirmedException":
      return "This account hasn't been verified yet. Check your email for a code.";
    case "PasswordResetRequiredException":
      return 'A password reset is required for this account. Use "Forgot password?" below.';
    case "AliasExistsException":
      return "An account with this email already exists.";
  }
  return message || "Something went wrong. Please try again.";
}

/** Feature bullets on the brand panel. Generic on purpose (white-label). */
const FEATURES = [
  {
    icon: <ForumOutlinedIcon />,
    title: "Ask in plain language",
    body: "Get direct answers instead of digging through documents.",
  },
  {
    icon: <LibraryBooksOutlinedIcon />,
    title: "Grounded in your knowledge base",
    body: "Every answer cites the source documents it came from.",
  },
  {
    icon: <GppGoodOutlinedIcon />,
    title: "Private and secure",
    body: "Your account and conversations are protected end to end.",
  },
];

export default function LoginPage({ onSignedIn }: LoginPageProps) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  // Same brand-over-tokens merge theme.ts uses, so panel colors match the app.
  const c = useMemo(
    () => ({
      ...tokens.colors[mode],
      ...(mode === "dark" ? brand.colorsDark : brand.colorsLight),
    }),
    [mode]
  );

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
  const handleSignInStep = async (nextStep: SignInNextStep) => {
    const step = nextStep.signInStep;
    if (step === "DONE") {
      onSignedIn();
      return;
    }
    if (step === "CONFIRM_SIGN_UP") {
      try {
        await resendSignUpCode({ username });
      } catch {
        // Best effort; the previous code may still be valid.
      }
      goTo("confirmSignUp");
      setInfo("This account still needs verification. We emailed you a code.");
      return;
    }
    if (step === "RESET_PASSWORD") {
      await resetPassword({ username });
      goTo("resetPassword", { clearPasswords: true });
      setInfo("A password reset is required. We emailed you a code.");
      return;
    }
    if (step === "CONFIRM_SIGN_IN_WITH_SMS_CODE") {
      setMfaHint(
        `We sent a code to ${nextStep.codeDeliveryDetails?.destination ?? "your phone"}.`
      );
      goTo("mfa");
      return;
    }
    if (step === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE") {
      setMfaHint(
        `We sent a code to ${nextStep.codeDeliveryDetails?.destination ?? "your email"}.`
      );
      goTo("mfa");
      return;
    }
    if (step === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
      setMfaHint("Enter the code from your authenticator app.");
      goTo("mfa");
      return;
    }
    if (step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      goTo("newPassword", { clearPasswords: true });
      return;
    }
    setError(
      `This account requires a sign-in step this app doesn't support yet. Please contact ${brand.supportContact}.`
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
        if ((err as { name?: string })?.name === "UserAlreadyAuthenticatedException") {
          onSignedIn();
          return;
        }
        setError(friendlyAuthError(err));
      } finally {
        setBusy(false);
      }
    };

  const handleSignIn = submit(async () => {
    const { nextStep } = await signIn({ username, password });
    await handleSignInStep(nextStep);
  });

  const finishAutoSignIn = async () => {
    try {
      const { nextStep } = await autoSignIn();
      await handleSignInStep(nextStep);
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
    const { nextStep } = await signUp({
      username,
      password,
      options: {
        userAttributes: { email: username, name: fullName.trim() },
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

  const handleMfa = submit(async () => {
    const { nextStep } = await confirmSignIn({ challengeResponse: code.trim() });
    await handleSignInStep(nextStep);
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
    await handleSignInStep(nextStep);
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

  const emailField = (props?: { autoFocus?: boolean; disabled?: boolean }) => (
    <TextField
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      autoComplete="email"
      required
      fullWidth
      autoFocus={props?.autoFocus}
      disabled={props?.disabled || busy}
    />
  );

  const codeField = (label = "Verification code") => (
    <TextField
      label={label}
      value={code}
      onChange={(e) => setCode(e.target.value)}
      autoComplete="one-time-code"
      inputMode="numeric"
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
            required
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
        <Stack component="form" onSubmit={handleMfa} spacing={2.25} noValidate>
          {heading("Two-step verification", mfaHint || "Enter your verification code.")}
          {alerts}
          {codeField()}
          {submitButton("Verify")}
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
        </Stack>
      );
  }

  // ---------------------------------------------------------------------
  // Page layout
  // ---------------------------------------------------------------------

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        bgcolor: "background.default",
      }}
    >
      {/* Brand panel (desktop only) */}
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flex: "1 1 55%",
          position: "relative",
          overflow: "hidden",
          flexDirection: "column",
          justifyContent: "space-between",
          p: { md: 6, lg: 8 },
          color: c.headerText,
          backgroundColor: c.headerBg,
          backgroundImage: `linear-gradient(160deg, ${c.headerBg} 0%, color-mix(in srgb, ${c.headerBg} 55%, ${c.secondary}) 100%)`,
        }}
      >
        {/* Decorative shapes */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(560px circle at 85% 12%, rgba(255,255,255,0.09), transparent 60%)," +
              "radial-gradient(680px circle at 8% 95%, rgba(255,255,255,0.07), transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <Box
          component="img"
          src={brand.assets.logoDark}
          alt=""
          sx={{ height: 44, alignSelf: "flex-start", position: "relative" }}
        />
        <Box sx={{ position: "relative", maxWidth: 520 }}>
          <Typography
            variant="h3"
            component="p"
            sx={{ fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}
          >
            {brand.assistantName}
          </Typography>
          <Typography sx={{ mt: 2, mb: 5, opacity: 0.85, fontSize: "1.05rem" }}>
            {brand.tagline}
          </Typography>
          <Stack spacing={3}>
            {FEATURES.map((feature) => (
              <Stack key={feature.title} direction="row" spacing={2} alignItems="flex-start">
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 2,
                    flexShrink: 0,
                    bgcolor: "rgba(255,255,255,0.12)",
                    "& svg": { fontSize: 22 },
                  }}
                >
                  {feature.icon}
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>{feature.title}</Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {feature.body}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ opacity: 0.7, position: "relative" }}>
          © {new Date().getFullYear()} {brand.organizationName}
          {brand.parentOrg ? ` · ${brand.parentOrg}` : ""}
        </Typography>
      </Box>

      {/* Form panel */}
      <Box
        sx={{
          flex: "1 1 45%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          px: { xs: 3, sm: 6 },
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
          {/* Mobile-only logo (the brand panel is hidden below md) */}
          <Box
            component="img"
            src={mode === "dark" ? brand.assets.logoDark : brand.assets.logo}
            alt={brand.organizationName}
            sx={{ height: 40, mb: 4, display: { xs: "block", md: "none" } }}
          />
          {content}
        </Box>

        <Typography
          variant="caption"
          sx={{
            mt: 5,
            color: "text.secondary",
            display: { xs: "block", md: "none" },
          }}
        >
          © {new Date().getFullYear()} {brand.organizationName}
        </Typography>
      </Box>
    </Box>
  );
}

/** Live checklist of the pool's password policy, shown while typing. */
function PasswordChecklist({ value }: { value: string }) {
  return (
    <Box
      component="ul"
      sx={{
        listStyle: "none",
        m: 0,
        mt: -1,
        p: 1.5,
        borderRadius: 2,
        bgcolor: "action.hover",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 0.75,
      }}
    >
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <Box
            component="li"
            key={rule.label}
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            {ok ? (
              <CheckCircleRoundedIcon sx={{ fontSize: 16, color: "success.main" }} />
            ) : (
              <CircleOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
            )}
            <Typography
              variant="caption"
              sx={{ color: ok ? "text.primary" : "text.secondary" }}
            >
              {rule.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
