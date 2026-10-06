import { useState } from "react";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ForwardToInboxOutlinedIcon from "@mui/icons-material/ForwardToInboxOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { AdminUser } from "../../../common/api-client/users-client";
import { Utils } from "../../../common/utils";

export type UserAction = "toggleAdmin" | "toggleEnabled" | "resendInvite" | "delete";

/** Cognito status -> label and chip color. */
const STATUS_LABELS: Record<string, { label: string; color: "success" | "warning" | "default" }> = {
  CONFIRMED: { label: "Active", color: "success" },
  FORCE_CHANGE_PASSWORD: { label: "Invited", color: "warning" },
  UNCONFIRMED: { label: "Unverified", color: "warning" },
  RESET_REQUIRED: { label: "Reset required", color: "warning" },
};

interface UserRowProps {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onAction: (user: AdminUser, action: UserAction) => void;
}

export default function UserRow({ user, isSelf, busy, onAction }: UserRowProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const status = STATUS_LABELS[user.status] ?? { label: user.status, color: "default" as const };
  const pendingInvite = user.status === "FORCE_CHANGE_PASSWORD";
  const selfReason = "You can't change your own account here";

  const choose = (action: UserAction) => {
    setAnchorEl(null);
    onAction(user, action);
  };

  return (
    <TableRow hover>
      <TableCell sx={{ maxWidth: 280 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {user.email || user.username}
        </Typography>
        {isSelf && (
          <Typography variant="caption" color="text.secondary">
            You
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {user.enabled ? (
            <Chip size="small" label={status.label} color={status.color} variant="outlined" />
          ) : (
            <Chip size="small" label="Disabled" variant="outlined" />
          )}
          {user.isAdmin && <Chip size="small" label="Admin" color="primary" />}
        </Stack>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>
        {Utils.formatTimestamp(user.createdAt)}
      </TableCell>
      <TableCell align="right">
        <IconButton
          aria-label={`Actions for ${user.email || user.username}`}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          disabled={busy}
          size="small"
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <SelfGuard isSelf={isSelf && user.isAdmin} reason={selfReason}>
            <MenuItem onClick={() => choose("toggleAdmin")} disabled={isSelf && user.isAdmin}>
              <ListItemIcon>
                <AdminPanelSettingsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{user.isAdmin ? "Remove admin access" : "Make admin"}</ListItemText>
            </MenuItem>
          </SelfGuard>
          {pendingInvite && (
            <MenuItem onClick={() => choose("resendInvite")}>
              <ListItemIcon>
                <ForwardToInboxOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Resend invitation</ListItemText>
            </MenuItem>
          )}
          <SelfGuard isSelf={isSelf} reason={selfReason}>
            <MenuItem onClick={() => choose("toggleEnabled")} disabled={isSelf}>
              <ListItemIcon>
                {user.enabled ? (
                  <BlockOutlinedIcon fontSize="small" />
                ) : (
                  <CheckCircleOutlineIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>{user.enabled ? "Disable sign-in" : "Enable sign-in"}</ListItemText>
            </MenuItem>
          </SelfGuard>
          <SelfGuard isSelf={isSelf} reason={selfReason}>
            <MenuItem onClick={() => choose("delete")} disabled={isSelf} sx={{ color: "error.main" }}>
              <ListItemIcon sx={{ color: "inherit" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Delete user</ListItemText>
            </MenuItem>
          </SelfGuard>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

/** Wraps a disabled self-action in a tooltip explaining why it's unavailable. */
function SelfGuard({
  isSelf,
  reason,
  children,
}: {
  isSelf: boolean;
  reason: string;
  children: React.ReactElement;
}) {
  if (!isSelf) return children;
  return (
    <Tooltip title={reason} placement="left">
      <span>{children}</span>
    </Tooltip>
  );
}
