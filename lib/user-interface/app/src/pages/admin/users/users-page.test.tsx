import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import UsersPage from "./users-page";
import { AppContext } from "../../../common/app-context";
import { NotificationContext } from "../../../components/notif-manager";
import type { AppConfig } from "../../../common/types";
import type { AdminUser } from "../../../common/api-client/users-client";

const users = vi.hoisted(() => ({
  listUsers: vi.fn(),
  inviteUser: vi.fn(),
  setAdmin: vi.fn(),
  setEnabled: vi.fn(),
  resendInvite: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("../../../common/api-client/api-client", () => ({
  ApiClient: class {
    users = users;
  },
}));

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        payload: { "cognito:username": "me@example.com", email: "me@example.com", sub: "sub-me" },
      },
    },
  }),
}));

const config: AppConfig = {
  Auth: { region: "us-east-1", userPoolId: "us-east-1_x", userPoolWebClientId: "c" },
  httpEndpoint: "https://api.example.com/",
  wsEndpoint: "wss://ws.example.com",
};

const ME: AdminUser = {
  username: "me@example.com",
  email: "me@example.com",
  status: "CONFIRMED",
  enabled: true,
  isAdmin: true,
  createdAt: "2026-01-01T00:00:00Z",
};
const INVITED: AdminUser = {
  username: "new@example.com",
  email: "new@example.com",
  status: "FORCE_CHANGE_PASSWORD",
  enabled: true,
  isAdmin: false,
  createdAt: "2026-02-01T00:00:00Z",
};

const addNotification = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
      <AppContext.Provider value={config}>
        <NotificationContext.Provider
          value={{ notifications: [], addNotification, removeNotification: vi.fn() }}
        >
          <UsersPage />
        </NotificationContext.Provider>
      </AppContext.Provider>
    </MemoryRouter>
  );
}

async function openMenuFor(email: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${email}` }));
  return screen.findByRole("menu");
}

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.listUsers.mockResolvedValue({ users: [ME, INVITED], nextToken: null });
    for (const fn of [users.setAdmin, users.setEnabled, users.resendInvite, users.deleteUser, users.inviteUser]) {
      fn.mockResolvedValue({});
    }
  });

  it("lists users with status and admin badges", async () => {
    renderPage();
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("shows an error with Retry when listing fails", async () => {
    users.listUsers.mockRejectedValueOnce(new Error("Forbidden"));
    renderPage();
    expect(await screen.findByText(/couldn't load users: forbidden/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    users.listUsers.mockResolvedValue({ users: [], nextToken: null });
    renderPage();
    expect(await screen.findByText(/no users yet/i)).toBeInTheDocument();
  });

  it("invites a user as admin", async () => {
    renderPage();
    await screen.findByText("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: /invite user/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: " Pat@Example.com " } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));

    await waitFor(() => expect(users.inviteUser).toHaveBeenCalledWith("pat@example.com", true));
    expect(addNotification).toHaveBeenCalledWith("success", "Invitation sent to pat@example.com.");
  });

  it("rejects an invalid email without calling the API", async () => {
    renderPage();
    await screen.findByText("new@example.com");
    fireEvent.click(screen.getByRole("button", { name: /invite user/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: "nope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));
    expect(await within(dialog).findByText(/valid email/i)).toBeInTheDocument();
    expect(users.inviteUser).not.toHaveBeenCalled();
  });

  it("toggles admin, disables, and resends an invite for another user", async () => {
    renderPage();
    let menu = await openMenuFor("new@example.com");
    fireEvent.click(within(menu).getByText(/make admin/i));
    await waitFor(() => expect(users.setAdmin).toHaveBeenCalledWith("new@example.com", true));

    menu = await openMenuFor("new@example.com");
    fireEvent.click(within(menu).getByText(/disable sign-in/i));
    await waitFor(() => expect(users.setEnabled).toHaveBeenCalledWith("new@example.com", false));

    menu = await openMenuFor("new@example.com");
    fireEvent.click(within(menu).getByText(/resend invitation/i));
    await waitFor(() => expect(users.resendInvite).toHaveBeenCalledWith("new@example.com"));
  });

  it("deletes only after confirmation", async () => {
    renderPage();
    const menu = await openMenuFor("new@example.com");
    fireEvent.click(within(menu).getByText(/delete user/i));
    const dialog = await screen.findByRole("dialog", { name: /delete this user/i });
    expect(users.deleteUser).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /delete user/i }));
    await waitFor(() => expect(users.deleteUser).toHaveBeenCalledWith("new@example.com"));
    await waitFor(() => expect(screen.queryByText("new@example.com")).not.toBeInTheDocument());
  });

  it("disables self-destructive actions on your own row", async () => {
    renderPage();
    const menu = await openMenuFor("me@example.com");
    for (const label of [/remove admin access/i, /disable sign-in/i, /delete user/i]) {
      expect(within(menu).getByText(label).closest("li")).toHaveAttribute("aria-disabled", "true");
    }
  });
});
