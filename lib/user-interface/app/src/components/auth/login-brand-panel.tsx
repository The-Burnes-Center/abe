/** Left-hand brand panel of the login page (desktop only). */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LibraryBooksOutlinedIcon from "@mui/icons-material/LibraryBooksOutlined";
import GppGoodOutlinedIcon from "@mui/icons-material/GppGoodOutlined";
import { brand } from "../../common/brand";
import { themeColors } from "../../common/theme";

/** Feature bullets on the brand panel. Generic on purpose (white-label). */
const FEATURES = [
  {
    icon: <ForumOutlinedIcon />,
    title: "Ask in plain language",
    body: "Get direct answers instead of digging through documents.",
  },
  {
    icon: <LibraryBooksOutlinedIcon />,
    title: "Grounded in your knowledge base",
    body: "Every answer cites the source documents it came from.",
  },
  {
    icon: <GppGoodOutlinedIcon />,
    title: "Private to your organization",
    body: "Accounts are managed by your administrators, and conversations stay in your organization's own cloud account.",
  },
];

export default function LoginBrandPanel() {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const c = themeColors(mode);

  return (
    <Box
      sx={{
        display: { xs: "none", md: "flex" },
        flex: "1 1 55%",
        position: "relative",
        overflow: "hidden",
        flexDirection: "column",
        justifyContent: "space-between",
        p: { md: 6, lg: 8 },
        color: c.headerText,
        backgroundColor: c.headerBg,
        backgroundImage: `linear-gradient(160deg, ${c.headerBg} 0%, color-mix(in srgb, ${c.headerBg} 55%, ${c.secondary}) 100%)`,
      }}
    >
      {/* Decorative shapes */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(560px circle at 85% 12%, rgba(255,255,255,0.09), transparent 60%)," +
            "radial-gradient(680px circle at 8% 95%, rgba(255,255,255,0.07), transparent 60%)",
          pointerEvents: "none",
        }}
      />
      <Box
        component="img"
        src={brand.assets.logoDark}
        alt=""
        sx={{ height: 96, alignSelf: "flex-start", position: "relative" }}
      />
      <Box sx={{ position: "relative", maxWidth: 520 }}>
        <Typography
          variant="h3"
          component="p"
          sx={{ fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          {brand.assistantName}
        </Typography>
        <Typography sx={{ mt: 2, mb: 5, opacity: 0.85, fontSize: "1.05rem" }}>
          {brand.tagline}
        </Typography>
        <Stack spacing={3}>
          {FEATURES.map((feature) => (
            <Stack key={feature.title} direction="row" spacing={2} alignItems="flex-start">
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 42,
                  height: 42,
                  borderRadius: 2,
                  flexShrink: 0,
                  bgcolor: "rgba(255,255,255,0.12)",
                  "& svg": { fontSize: 22 },
                }}
              >
                {feature.icon}
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 700 }}>{feature.title}</Typography>
                <Typography variant="body2" sx={{ opacity: 0.85 }}>
                  {feature.body}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>
      {/* Explicit color (not inherit + low opacity) keeps this >= 4.5:1 on the gradient. */}
      <Typography variant="caption" sx={{ color: c.headerText, position: "relative" }}>
        © {new Date().getFullYear()} {brand.organizationName}
        {brand.parentOrg ? ` · ${brand.parentOrg}` : ""}
      </Typography>
    </Box>
  );
}
