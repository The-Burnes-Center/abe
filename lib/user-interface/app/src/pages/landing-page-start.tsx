import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useDocumentTitle } from "../common/hooks/use-document-title";
import { brand } from "../common/brand";
import LandingShell from "../components/landing/landing-shell";
import { fadeInSx, slideHeadingSx } from "../components/landing/landing-styles";

export default function LandingPageStart() {
  useDocumentTitle("Get started");
  const navigate = useNavigate();

  return (
    <LandingShell next="chat" back="/about">
      <Typography
        component="h1"
        sx={{ ...slideHeadingSx, fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 600, ...fadeInSx() }}
      >
        The more specific your questions, the better I can help.
      </Typography>
      <Button
        onClick={() => navigate(`/chatbot/playground/${uuidv4()}`)}
        variant="contained"
        size="large"
        sx={{
          px: 4,
          py: 1.5,
          fontWeight: 700,
          bgcolor: "#FFFFFF",
          color: brand.colorsLight.headerBg,
          "&:hover": { bgcolor: "rgba(255,255,255,0.9)" },
          ...fadeInSx(0.15),
        }}
      >
        Get started &rarr;
      </Button>
    </LandingShell>
  );
}
