import { FormEvent, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolves on success; rejects with a user-facing message on failure. */
  onInvite: (email: string, isAdmin: boolean) => Promise<void>;
}

export default function InviteUserDialog({ open, onClose, onInvite }: InviteUserDialogProps) {
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setEmail("");
    setIsAdmin(false);
    setError("");
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onInvite(normalized, isAdmin);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error)?.message || "Could not invite user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>Invite a user</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              They'll get an email with a temporary password and will choose their own password the
              first time they sign in.
            </DialogContentText>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoFocus
              required
              fullWidth
              disabled={busy}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  disabled={busy}
                />
              }
              label="Administrator (can manage data, feedback, users and settings)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : "Send invitation"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
