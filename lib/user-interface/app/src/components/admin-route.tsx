/**
 * Route-level guard for everything under /admin. Non-admins see a "not
 * authorized" message instead of the page; the admin APIs reject them
 * server-side as well, so this only keeps the UI honest.
 */
import { Outlet } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { useIsAdmin } from "../common/auth";

export default function AdminRoute() {
  const admin = useIsAdmin();

  if (admin === null) {
    return (
      <Stack spacing={3} aria-busy="true" aria-label="Checking access">
        <Skeleton variant="text" width={200} height={24} />
        <Skeleton variant="text" width={300} height={40} />
        <Skeleton variant="rounded" height={200} />
      </Stack>
    );
  }

  if (!admin) {
    return (
      <Box sx={{ height: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Alert severity="error">
          You are not authorized to view this page. Ask an administrator if you need access.
        </Alert>
      </Box>
    );
  }

  return <Outlet />;
}
