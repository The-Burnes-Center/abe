import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import LoginPage from "./login-page";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  autoSignIn: vi.fn(),
}));

vi.mock("aws-amplify/auth", () => auth);

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

  it("routes an MFA challenge to the verification view, then completes", async () => {
    auth.signIn.mockResolvedValue({
      nextStep: {
        signInStep: "CONFIRM_SIGN_IN_WITH_SMS_CODE",
        codeDeliveryDetails: { destination: "+*******1234" },
      },
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
    render(<LoginPage onSignedIn={vi.fn()} />);

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
    render(<LoginPage onSignedIn={vi.fn()} />);

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
