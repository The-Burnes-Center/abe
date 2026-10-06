/**
 * Admin > Users: invite people, grant or remove admin access, disable,
 * re-invite and delete accounts. Admin-only (route guard + server checks).
 * Self-destructive actions (remove own admin, disable or delete yourself) are
 * blocked here and rejected by the API as well.
 */
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import PersonAddAlt1OutlinedIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import { fetchAuthSession } from "aws-amplify/auth";
import AdminPageLayout from "../../../components/admin-page-layout";
import { useNotifications } from "../../../components/notif-manager";
import { ApiClient } from "../../../common/api-client/api-client";
import type { AdminUser } from "../../../common/api-client/users-client";
import { AppContext } from "../../../common/app-context";
import { identityFromPayload, type CurrentIdentity } from "../../../common/auth";
import { isSelfUser } from "./is-self";
import { useDocumentTitle } from "../../../common/hooks/use-document-title";
import { Utils } from "../../../common/utils";
import InviteUserDialog from "./invite-user-dialog";
import UserRow, { type UserAction } from "./user-row";

const LOADING_ROWS = 3;

export default function UsersPage() {
  useDocumentTitle("Admin · Users");
  const appContext = useContext(AppContext);
  const apiClient = useMemo(() => new ApiClient(appContext!), [appContext]);
  const { addNotification } = useNotifications();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState<CurrentIdentity | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await apiClient.users.listUsers();
      setUsers(page.users ?? []);
      setNextToken(page.nextToken ?? null);
    } catch (err) {
      setError(Utils.getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
    fetchAuthSession()
      .then((session) => setMe(identityFromPayload(session.tokens?.idToken?.payload)))
      .catch(() => setMe(null));
  }, [load]);

  const loadMore = async () => {
    if (!nextToken) return;
    setLoadingMore(true);
    try {
      const page = await apiClient.users.listUsers(nextToken);
      setUsers((prev) => [...prev, ...(page.users ?? [])]);
      setNextToken(page.nextToken ?? null);
    } catch (err) {
      addNotification("error", Utils.getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const replaceUser = (username: string, patch: Partial<AdminUser>) =>
    setUsers((prev) => prev.map((u) => (u.username === username ? { ...u, ...patch } : u)));

  const runAction = async (user: AdminUser, work: () => Promise<void>, success: string) => {
    setBusyUser(user.username);
    try {
      await work();
      addNotification("success", success);
    } catch (err) {
      addNotification("error", Utils.getErrorMessage(err));
    } finally {
      setBusyUser(null);
    }
  };

  const handleAction = (user: AdminUser, action: UserAction) => {
    const label = user.email || user.username;
    const self = isSelfUser(user, me);
    if (self && action !== "resendInvite" && !(action === "toggleAdmin" && !user.isAdmin)) {
      addNotification("error", "You can't remove your own admin access, disable or delete yourself.");
      return;
    }
    switch (action) {
      case "toggleAdmin":
        void runAction(
          user,
          async () => {
            await apiClient.users.setAdmin(user.username, !user.isAdmin);
            replaceUser(user.username, { isAdmin: !user.isAdmin });
          },
          user.isAdmin ? `${label} is no longer an admin.` : `${label} is now an admin.`
        );
        return;
      case "toggleEnabled":
        void runAction(
          user,
          async () => {
            await apiClient.users.setEnabled(user.username, !user.enabled);
            replaceUser(user.username, { enabled: !user.enabled });
          },
          user.enabled ? `${label} can no longer sign in.` : `${label} can sign in again.`
        );
        return;
      case "resendInvite":
        void runAction(
          user,
          () => apiClient.users.resendInvite(user.username).then(() => undefined),
          `Invitation re-sent to ${label}.`
        );
        return;
      case "delete":
        setPendingDelete(user);
    }
  };

  const confirmDelete = async () => {
    const user = pendingDelete;
    if (!user) return;
    setPendingDelete(null);
    await runAction(
      user,
      async () => {
        await apiClient.users.deleteUser(user.username);
        setUsers((prev) => prev.filter((u) => u.username !== user.username));
      },
      `${user.email || user.username} was deleted.`
    );
  };

  const handleInvite = async (email: string, isAdmin: boolean) => {
    await apiClient.users.inviteUser(email, isAdmin);
    addNotification("success", `Invitation sent to ${email}.`);
    await load();
  };

  return (
    <AdminPageLayout
      title="Users"
      description="Invite people to the assistant and decide who can administer it."
      breadcrumbLabel="Users"
      actions={
        <Button
          variant="contained"
          startIcon={<PersonAddAlt1OutlinedIcon />}
          onClick={() => setInviteOpen(true)}
        >
          Invite user
        </Button>
      }
    >
      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          Couldn't load users: {error}
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Users">
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Status</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>Created</TableCell>
                <TableCell align="right">
                  <span className="sr-only">Actions</span>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                Array.from({ length: LOADING_ROWS }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton variant="text" />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Box sx={{ py: 4, textAlign: "center" }}>
                      <Typography sx={{ fontWeight: 600 }}>No users yet</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Invite someone by email to give them access.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                users.map((user) => (
                  <UserRow
                    key={user.username}
                    user={user}
                    isSelf={isSelfUser(user, me)}
                    busy={busyUser === user.username}
                    onAction={handleAction}
                  />
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {nextToken && !loading && !error && (
        <Stack alignItems="center">
          <Button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </Stack>
      )}

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
      />

      <Dialog open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Delete this user?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pendingDelete?.email || pendingDelete?.username} will lose access immediately. This
            can't be undone; you can invite them again later. Their past conversations are not
            deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()}>
            Delete user
          </Button>
        </DialogActions>
      </Dialog>
    </AdminPageLayout>
  );
}
