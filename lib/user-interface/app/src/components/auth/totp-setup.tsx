/**
 * TotpSetupDetails -- QR code plus manual key for enrolling an authenticator
 * app. Used by the sign-in TOTP setup challenge and the "Two-step
 * verification" dialog in the user menu.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";

interface TotpSetupDetailsProps {
  /** otpauth:// URI from Amplify's `getSetupUri()`. */
  setupUri: string;
  /** Base32 secret, for typing into the app when scanning isn't possible. */
  sharedSecret: string;
}

const QR_SIZE = 176;

/** Group the base32 key in blocks of four so it's easier to type. */
const formatKey = (key: string) => key.replace(/(.{4})/g, "$1 ").trim();

export default function TotpSetupDetails({ setupUri, sharedSecret }: TotpSetupDetailsProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand so the QR encoder stays out of the main bundle.
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(setupUri, { margin: 1, width: QR_SIZE }))
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setupUri]);

  return (
    <Stack spacing={1.5} alignItems="center">
      {qrFailed ? null : qrDataUrl ? (
        <Box
          component="img"
          src={qrDataUrl}
          alt="QR code to add this account to your authenticator app"
          width={QR_SIZE}
          height={QR_SIZE}
          sx={{ borderRadius: 1, bgcolor: "#FFFFFF", p: 0.5 }}
        />
      ) : (
        <Skeleton variant="rounded" width={QR_SIZE} height={QR_SIZE} />
      )}
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
        Can't scan? Enter this key in your authenticator app:
      </Typography>
      <Typography
        component="code"
        data-testid="totp-secret"
        sx={{
          fontFamily: "monospace",
          fontSize: "0.95rem",
          letterSpacing: "0.05em",
          px: 1.5,
          py: 0.75,
          borderRadius: 1,
          bgcolor: "action.hover",
          wordBreak: "break-all",
          textAlign: "center",
        }}
      >
        {formatKey(sharedSecret)}
      </Typography>
    </Stack>
  );
}
