/**
 * UsersClient -- admin user management (Cognito) via /admin/users.
 * Every route is admin-only server-side; failures carry `{ error }`.
 */
import { Utils } from "../utils";
import { AppConfig } from "../types";

export interface AdminUser {
  username: string;
  email: string;
  /** Cognito UserStatus, e.g. CONFIRMED, FORCE_CHANGE_PASSWORD, UNCONFIRMED. */
  status: string;
  enabled: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminUserPage {
  users: AdminUser[];
  nextToken?: string | null;
}

export class UsersClient {
  private readonly API: string;

  constructor(protected _appConfig: AppConfig) {
    this.API = _appConfig.httpEndpoint.replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
    const auth = await Utils.authenticate();
    const response = await fetch(this.API + path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: auth },
    });
    if (!response.ok) {
      throw new Error(await Utils.extractServerError(response, fallback));
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private userPath(username: string, action = "") {
    return `/admin/users/${encodeURIComponent(username)}${action ? `/${action}` : ""}`;
  }

  listUsers(nextToken?: string | null): Promise<AdminUserPage> {
    const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : "";
    return this.request(`/admin/users${query}`, { method: "GET" }, "Could not load users");
  }

  inviteUser(email: string, isAdmin: boolean): Promise<AdminUser> {
    return this.request(
      "/admin/users",
      { method: "POST", body: JSON.stringify({ email, isAdmin }) },
      "Could not invite user"
    );
  }

  setAdmin(username: string, isAdmin: boolean): Promise<unknown> {
    return this.request(
      this.userPath(username, "admin"),
      { method: "POST", body: JSON.stringify({ isAdmin }) },
      "Could not change admin access"
    );
  }

  setEnabled(username: string, enabled: boolean): Promise<unknown> {
    return this.request(
      this.userPath(username, enabled ? "enable" : "disable"),
      { method: "POST" },
      enabled ? "Could not enable user" : "Could not disable user"
    );
  }

  resendInvite(username: string): Promise<unknown> {
    return this.request(
      this.userPath(username, "resend-invite"),
      { method: "POST" },
      "Could not resend the invitation"
    );
  }

  deleteUser(username: string): Promise<unknown> {
    return this.request(this.userPath(username), { method: "DELETE" }, "Could not delete user");
  }
}
