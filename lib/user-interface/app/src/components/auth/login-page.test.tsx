import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import LoginPage from "./login-page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  confirmSignIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  autoSignIn: vi.fn(),
}));

vi.mock("aws-amplify/auth", () => auth);
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAAA") },
  toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
}));

const VALID_PASSWORD = "Sufficient#Pass9word";

function fillSignIn(email = "User@Example.com", password = "hunter2hunter2!A") {
  fireEvent.change(screen.getByLabelText(/^email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/^password/i), {
    target: { value: password },
  });
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signOut.mockResolvedValue(undefined);
  });

  it("renders the sign-in view by default", () => {
    render(<LoginPage onSignedIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("signs in and reports success, normalizing the email", async () => {
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    fillSignIn(" User@Example.com ");
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.signIn).toHaveBeenCalledWith(
      expect.objectContaining({ username: "user@example.com" })
    );
  });

  it("shows a friendly message on bad credentials", async () => {
    auth.signIn.mockRejectedValue(
      Object.assign(new Error("Incorrect username or password."), {
        name: "NotAuthorizedException",
      })
    );
    render(<LoginPage onSignedIn={vi.fn()} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByText(/incorrect email or password/i)
    ).toBeInTheDocument();
  });

  it("clears any stale local session before signing in", async () => {
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    render(<LoginPage onSignedIn={vi.fn()} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(auth.signIn).toHaveBeenCalled());
    expect(auth.signOut).toHaveBeenCalled();
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signIn.mock.invocationCallOrder[0]
    );
  });

  it("hides sign-up and explains invitations when self sign-up is off", () => {
    render(<LoginPage onSignedIn={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /create an account/i })).not.toBeInTheDocument();
    expect(screen.getByText(/accounts are created by invitation/i)).toBeInTheDocument();
  });

  it("offers sign-up when the deployment enables it", () => {
    render(<LoginPage onSignedIn={vi.fn()} selfSignUpEnabled />);
    expect(screen.getByRole("button", { name: /create an account/i })).toBeInTheDocument();
    expect(screen.queryByText(/accounts are created by invitation/i)).not.toBeInTheDocument();
  });

  it("sends an invited user with a temporary password to the new-password step", async () => {
    auth.signIn.mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED" },
    });
    auth.confirmSignIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: VALID_PASSWORD } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: VALID_PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: VALID_PASSWORD });
  });

  it("walks through TOTP setup with a QR code and manual key", async () => {
    const getSetupUri = vi.fn(() => new URL("otpauth://totp/ABE:user%40example.com?secret=JBSWY3DPEHPK3PXP"));
    auth.signIn.mockResolvedValue({
      nextStep: {
        signInStep: "CONTINUE_SIGN_IN_WITH_TOTP_SETUP",
        totpSetupDetails: { sharedSecret: "JBSWY3DPEHPK3PXP", getSetupUri },
      },
    });
    auth.confirmSignIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { name: /set up two-step verification/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("totp-secret")).toHaveTextContent("JBSW Y3DP EHPK 3PXP");
    expect(await screen.findByAltText(/qr code/i)).toBeInTheDocument();
    expect(getSetupUri).toHaveBeenCalledWith(expect.any(String), "user@example.com");

    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "123456" });
  });

  it("picks TOTP when Cognito asks which MFA method to use", async () => {
    auth.signIn.mockResolvedValue({
      nextStep: { signInStep: "CONTINUE_SIGN_IN_WITH_MFA_SELECTION", allowedMFATypes: ["EMAIL", "TOTP"] },
    });
    auth.confirmSignIn.mockResolvedValueOnce({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_TOTP_CODE" },
    });
    render(<LoginPage onSignedIn={vi.fn()} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/authenticator app/i)).toBeInTheDocument();
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "TOTP" });
  });

  it("routes a TOTP challenge to the verification view, then completes", async () => {
    auth.signIn.mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_TOTP_CODE" },
    });
    auth.confirmSignIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    fillSignIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { name: /two-step verification/i })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "123456" });
  });

  it("walks through sign-up to the email confirmation view", async () => {
    auth.signUp.mockResolvedValue({ nextStep: { signUpStep: "CONFIRM_SIGN_UP" } });
    render(<LoginPage onSignedIn={vi.fn()} selfSignUpEnabled />);

    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    expect(
      screen.getByRole("heading", { name: /create your account/i })
    ).toBeInTheDocument();
    // Password policy checklist is visible while choosing a password.
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Jane Smith" },
    });
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: VALID_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: VALID_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByRole("heading", { name: /check your email/i })
    ).toBeInTheDocument();
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "jane@example.com",
        password: VALID_PASSWORD,
      })
    );
  });

  it("rejects a weak password on sign-up without calling Cognito", async () => {
    render(<LoginPage onSignedIn={vi.fn()} selfSignUpEnabled />);

    fireEvent.click(screen.getByRole("button", { name: /create an account/i }));
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Jane Smith" },
    });
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText(/doesn't meet all the requirements/i)
    ).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sends a reset code from the forgot-password view", async () => {
    auth.resetPassword.mockResolvedValue({
      nextStep: {
        resetPasswordStep: "CONFIRM_RESET_PASSWORD_WITH_CODE",
        codeDeliveryDetails: { destination: "u***@e***.com" },
      },
    });
    render(<LoginPage onSignedIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(
      screen.getByRole("heading", { name: /reset your password/i })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset code/i }));

    expect(
      await screen.findByRole("heading", { name: /choose a new password/i })
    ).toBeInTheDocument();
    expect(auth.resetPassword).toHaveBeenCalledWith({ username: "user@example.com" });
  });
});
