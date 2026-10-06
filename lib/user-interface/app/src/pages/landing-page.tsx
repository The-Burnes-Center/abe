import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useDocumentTitle } from "../common/hooks/use-document-title";
import { brand } from "../common/brand";
import LandingShell from "../components/landing/landing-shell";
import { fadeInSx, slideHeadingSx } from "../components/landing/landing-styles";

export default function LandingPage() {
  useDocumentTitle("Home");
  const navigate = useNavigate();

  return (
    <LandingShell next="/about">
      <Typography
        component="h1"
        sx={{ ...slideHeadingSx, fontSize: "clamp(2.25rem, 8vw, 5rem)", ...fadeInSx() }}
      >
        Welcome to {brand.assistantName}
      </Typography>
      <Typography sx={{ fontSize: "clamp(1rem, 2.5vw, 1.25rem)", opacity: 0.9, ...fadeInSx(0.1) }}>
        {brand.tagline}
      </Typography>
      <Button
        onClick={() => navigate("/about")}
        size="large"
        sx={{ color: "inherit", fontSize: "1.05rem", ...fadeInSx(0.15) }}
      >
        Learn more about what I can do for you &rarr;
      </Button>
    </LandingShell>
  );
}
