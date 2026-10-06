import { useNavigate } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { useDocumentTitle } from "../common/hooks/use-document-title";
import LandingShell from "../components/landing/landing-shell";
import { fadeInSx, slideHeadingSx } from "../components/landing/landing-styles";

export default function LandingPageInfo() {
  useDocumentTitle("About");
  const navigate = useNavigate();

  return (
    <LandingShell next="/get-started" back="/">
      <Typography
        component="h1"
        sx={{ ...slideHeadingSx, fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 600, ...fadeInSx() }}
      >
        I give answers grounded in your organization's documents, with citations you can check.
      </Typography>
      <IconButton
        onClick={() => navigate("/get-started")}
        aria-label="Continue to Get Started"
        sx={{ color: "inherit", border: 1, borderColor: "currentColor", ...fadeInSx(0.15) }}
        size="large"
      >
        <ArrowForwardRoundedIcon />
      </IconButton>
    </LandingShell>
  );
}
