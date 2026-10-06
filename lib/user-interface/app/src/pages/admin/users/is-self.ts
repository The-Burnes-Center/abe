import type { AdminUser } from "../../../common/api-client/users-client";
import type { CurrentIdentity } from "../../../common/auth";

/** Whether a listed user is the signed-in admin (matched by username, sub or email). */
export function isSelfUser(user: AdminUser, me: CurrentIdentity | null): boolean {
  if (!me) return false;
  if (me.username && user.username === me.username) return true;
  if (me.sub && user.username === me.sub) return true;
  return Boolean(me.email) && user.email.toLowerCase() === me.email.toLowerCase();
}
