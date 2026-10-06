/**
 * MfaSettingsDialog -- lets a signed-in user turn authenticator-app (TOTP)
 * two-step verification on or off. With the pool's MFA set to optional this
 * is how people opt in; when the pool requires MFA, turning it off is
 * rejected by Cognito and the error is shown.
 */
import { FormEvent, useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import {
  fetchMFAPreference,
  setUpTOTP,
  updateMFAPreference,
  verifyTOTPSetup,
} from "aws-amplify/auth";
import { brand } from "../../common/brand";
import { friendlyAuthError } from "./auth-helpers";
import TotpSetupDetails from "./totp-setup";

interface MfaSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Shown as the account name in the authenticator app. */
  accountName: string;
}

type Step = "loading" | "enabled" | "disabled" | "setup";

export default function MfaSettingsDialog({ open, onClose, accountName }: MfaSettingsDialogProps) {
  const [step, setStep] = useState<Step>("loading");
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("loading");
    setError("");
    setInfo("");
    setCode("");
    fetchMFAPreference()
      .then((pref) => {
        if (!cancelled) setStep(pref.enabled?.includes("TOTP") ? "enabled" : "disabled");
      })
      .catch((err) => {
        if (cancelled) return;
        setStep("disabled");
        setError(friendlyAuthError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await work();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      const details = await setUpTOTP();
      setSetup({
        uri: details.getSetupUri(brand.assistantName, accountName).toString(),
        secret: details.sharedSecret,
      });
      setStep("setup");
    });

  const confirmSetup = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await verifyTOTPSetup({ code: code.trim() });
      await updateMFAPreference({ totp: "PREFERRED" });
      setStep("enabled");
      setInfo("Two-step verification is on. You'll be asked for a code when you sign in.");
    });
  };

  const turnOff = () =>
    run(async () => {
      await updateMFAPreference({ totp: "DISABLED" });
      setStep("disabled");
      setInfo("Two-step verification is off.");
    });

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Two-step verification</DialogTitle>
      <DialogContent>
        <Stack spacing={2} component="form" id="mfa-setup-form" onSubmit={confirmSetup} noValidate>
          {info && <Alert severity="success">{info}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {step === "loading" && <Skeleton variant="rounded" height={64} />}
          {step === "enabled" && (
            <Typography>
              Sign-in asks for a code from your authenticator app in addition to your password.
            </Typography>
          )}
          {step === "disabled" && (
            <Typography>
              Add a second step to sign-in: after your password, enter a 6-digit code from an
              authenticator app on your phone.
            </Typography>
          )}
          {step === "setup" && setup && (
            <>
              <Typography variant="body2">
                Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
              </Typography>
              <TotpSetupDetails setupUri={setup.uri} sharedSecret={setup.secret} />
              <TextField
                label="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputProps={{ inputMode: "numeric" }}
                required
                fullWidth
                autoFocus
                disabled={busy}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        {step === "enabled" && (
          <Button color="error" onClick={() => void turnOff()} disabled={busy}>
            Turn off
          </Button>
        )}
        {step === "disabled" && (
          <Button variant="contained" onClick={() => void startSetup()} disabled={busy}>
            Set up
          </Button>
        )}
        {step === "setup" && (
          <Button type="submit" form="mfa-setup-form" variant="contained" disabled={busy || !code.trim()}>
            Verify and turn on
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
