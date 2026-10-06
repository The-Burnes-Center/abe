import { Alert, AlertTitle, Button } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

interface LoadErrorPanelProps {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Shown in place of the analytics tabs when the metrics request fails. */
export default function LoadErrorPanel({ message, onRetry, retrying }: LoadErrorPanelProps) {
  return (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={onRetry} disabled={retrying}>
          Retry
        </Button>
      }
    >
      <AlertTitle>Couldn't load analytics</AlertTitle>
      {message}
    </Alert>
  );
}
