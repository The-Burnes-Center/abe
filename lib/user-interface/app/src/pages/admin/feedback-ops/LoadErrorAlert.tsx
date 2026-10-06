import { Alert, AlertTitle, Button } from "@mui/material";

interface LoadErrorAlertProps {
  title: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Inline load failure with a Retry action, kept distinct from "no data yet" empty states. */
export default function LoadErrorAlert({ title, message, onRetry, retrying = false }: LoadErrorAlertProps) {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" size="small" onClick={onRetry} disabled={retrying} sx={{ textTransform: "none" }}>
          {retrying ? "Retrying..." : "Retry"}
        </Button>
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {message}
    </Alert>
  );
}
