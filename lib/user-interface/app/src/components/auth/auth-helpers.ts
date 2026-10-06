/** Mirrors the pool password policy in lib/authorization/index.ts. */
export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
  { label: "A symbol", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export const passwordMeetsRules = (p: string) =>
  PASSWORD_RULES.every((rule) => rule.test(p));

/** Map Cognito error codes onto messages a person can act on. */
export function friendlyAuthError(err: unknown): string {
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
    case "EnableSoftwareTokenMFAException":
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
    case "UserLambdaValidationException":
      // PreSignUp trigger rejection (email domain not on the allowlist).
      return "Sign-up is not available for this email address.";
  }
  return message || "Something went wrong. Please try again.";
}
