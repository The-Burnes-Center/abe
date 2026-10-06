import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Box from "@mui/material/Box";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import { useTheme } from "@mui/material/styles";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import PhonelinkLockOutlinedIcon from "@mui/icons-material/PhonelinkLockOutlined";
import { fetchAuthSession } from "aws-amplify/auth";
import { v4 as uuidv4 } from "uuid";
import { StorageHelper } from "../common/helpers/storage-helper";
import { Utils } from "../common/utils";
import { themeColors } from "../common/theme";
import { brand } from "../common/brand";
import MfaSettingsDialog from "./auth/mfa-settings-dialog";

interface GlobalHeaderProps {
  onMenuClick?: () => void;
  menuExpanded?: boolean;
}

const HOVER_BG = "rgba(255,255,255,0.12)";

export default function GlobalHeader({ onMenuClick, menuExpanded }: GlobalHeaderProps) {
  const navigate = useNavigate();
  const mode = useTheme().palette.mode;
  const [userName, setUserName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mfaOpen, setMfaOpen] = useState(false);

  useEffect(() => {
    fetchAuthSession()
      .then((session) => {
        const payload = session.tokens?.idToken?.payload;
        if (!payload) {
          Utils.redirectToLogin();
          return;
        }
        const name = typeof payload.name === "string" ? payload.name : "";
        const mail = typeof payload.email === "string" ? payload.email : "";
        setEmail(mail);
        setUserName(name || mail || null);
      })
      .catch(() => Utils.redirectToLogin());
  }, []);

  const onChangeThemeClick = () => {
    StorageHelper.applyTheme(mode === "dark" ? "light" : "dark");
  };

  const handleSignOut = () => {
    setAnchorEl(null);
    void Utils.signOut();
  };

  const c = themeColors(mode);
  const initials = userName ? userName.split(/[\s@]+/)[0].charAt(0).toUpperCase() : "U";
  const iconSx = { color: c.headerText, "&:hover": { bgcolor: HOVER_BG } };

  return (
    <AppBar
      position="sticky"
      role="banner"
      sx={{
        top: 0,
        zIndex: (t) => t.zIndex.drawer + 1,
        bgcolor: c.headerBg,
        color: c.headerText,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, px: { xs: 1, sm: 2.5 }, gap: 1 }}>
        {onMenuClick && (
          <IconButton
            color="inherit"
            edge="start"
            onClick={onMenuClick}
            aria-label={menuExpanded ? "Hide navigation menu" : "Show navigation menu"}
            aria-expanded={menuExpanded}
            sx={{ flexShrink: 0 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        <Box
          component="button"
          onClick={() => navigate(`/chatbot/playground/${uuidv4()}`)}
          aria-label={`Open ${brand.assistantName} chat in a new session`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            minWidth: 0,
            flex: "0 1 auto",
            background: "none",
            border: "none",
            cursor: "pointer",
            p: 0,
            mr: "auto",
            borderRadius: 1,
            color: "inherit",
          }}
        >
          <Box
            component="img"
            src={brand.assets.icon}
            alt=""
            sx={{ height: { xs: 28, sm: 32 }, width: { xs: 28, sm: 32 }, flexShrink: 0 }}
          />
          <Typography
            variant="subtitle1"
            noWrap
            sx={{
              minWidth: 0,
              color: c.headerText,
              fontWeight: 700,
              fontSize: { xs: "0.9375rem", sm: "1rem" },
              letterSpacing: "-0.01em",
            }}
          >
            <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
              {brand.shortName}
            </Box>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              {brand.assistantName}
            </Box>
          </Typography>
        </Box>

        <Stack direction="row" spacing={{ xs: 0, sm: 0.5 }} alignItems="center" sx={{ flexShrink: 0 }}>
          <Tooltip title="Help & Guide">
            <IconButton color="inherit" onClick={() => navigate("/help")} aria-label="Help and guide" sx={iconSx}>
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <IconButton
              color="inherit"
              onClick={onChangeThemeClick}
              aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              sx={iconSx}
            >
              {mode === "dark" ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title={userName || "Account"}>
            <IconButton
              onClick={(e) => setAnchorEl(e.currentTarget)}
              aria-label="Account menu"
              aria-haspopup="true"
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  bgcolor: "rgba(255,255,255,0.15)",
                  color: c.headerText,
                }}
              >
                {initials}
              </Avatar>
            </IconButton>
          </Tooltip>
        </Stack>

        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {userName && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2, py: 1, maxWidth: 280, overflowWrap: "anywhere" }}
            >
              {userName}
            </Typography>
          )}
          {userName && <Divider />}
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              setMfaOpen(true);
            }}
          >
            <ListItemIcon>
              <PhonelinkLockOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Two-step verification
          </MenuItem>
          <MenuItem onClick={handleSignOut}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
      <MfaSettingsDialog open={mfaOpen} onClose={() => setMfaOpen(false)} accountName={email} />
    </AppBar>
  );
}
