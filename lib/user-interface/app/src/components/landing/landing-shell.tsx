/**
 * Shared layout for the three intro slides (/, /about, /get-started):
 * brand-colored backdrop, brand logo, "Skip to Chat" and arrow-key navigation.
 * First-time visitors see the intro; once onboarding has been seen, the
 * slides send people straight to a new chat.
 */
import { ReactNode, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useTheme } from "@mui/material/styles";
import { brand } from "../../common/brand";
import { StorageHelper } from "../../common/helpers/storage-helper";
import { fadeInSx } from "./landing-styles";

const LOGO_HEIGHT = { xs: 56, sm: 72 };

interface LandingShellProps {
  children: ReactNode;
  /** Path for ArrowRight (or the action to start chatting when "chat"). */
  next?: string | "chat";
  /** Path for ArrowLeft. */
  back?: string;
}

export default function LandingShell({ children, next, back }: LandingShellProps) {
  const navigate = useNavigate();
  const mode = useTheme().palette.mode;
  const c = mode === "dark" ? brand.colorsDark : brand.colorsLight;
  const seen = StorageHelper.getOnboardingSeen();

  useEffect(() => {
    const go = (target: string) =>
      navigate(target === "chat" ? `/chatbot/playground/${uuidv4()}` : target);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && next) go(next);
      else if (event.key === "ArrowLeft" && back) go(back);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, next, back]);

  if (seen) {
    return <Navigate to={`/chatbot/playground/${uuidv4()}`} replace />;
  }

  return (
    <Box
      component="main"
      id="main-content"
      tabIndex={-1}
      sx={{
        position: "relative",
        flex: "1 1 auto",
        minHeight: "100dvh",
        width: "100%",
        px: { xs: 2, sm: 6 },
        py: 3,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        overflow: "hidden",
        color: c.headerText,
        backgroundColor: c.headerBg,
        backgroundImage: `radial-gradient(900px circle at 85% 110%, color-mix(in srgb, ${c.primary} 55%, transparent), transparent 60%), linear-gradient(160deg, ${c.headerBg} 0%, color-mix(in srgb, ${c.headerBg} 75%, ${c.primary}) 100%)`,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          p: { xs: 2, sm: 3 },
        }}
      >
        <Box component="img" src={brand.assets.logoDark} alt={brand.organizationName} sx={{ height: LOGO_HEIGHT }} />
        <Button
          onClick={() => navigate(`/chatbot/playground/${uuidv4()}`)}
          aria-label="Skip introduction and go to chat"
          variant="outlined"
          sx={{
            color: c.headerText,
            borderColor: "currentColor",
            "&:hover": { borderColor: "currentColor", bgcolor: "rgba(255,255,255,0.08)" },
            ...fadeInSx(),
          }}
        >
          Skip to chat &rarr;
        </Button>
      </Box>
      <Box sx={{ maxWidth: 760, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        {children}
      </Box>
    </Box>
  );
}
