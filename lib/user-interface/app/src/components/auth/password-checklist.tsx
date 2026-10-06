import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import { PASSWORD_RULES } from "./auth-helpers";

/** Live checklist of the pool's password policy, shown while typing. */
export default function PasswordChecklist({ value }: { value: string }) {
  return (
    <Box
      component="ul"
      sx={{
        listStyle: "none",
        m: 0,
        mt: -1,
        p: 1.5,
        borderRadius: 2,
        bgcolor: "action.hover",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 0.75,
      }}
    >
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <Box
            component="li"
            key={rule.label}
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            {ok ? (
              <CheckCircleRoundedIcon sx={{ fontSize: 16, color: "success.main" }} />
            ) : (
              <CircleOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
            )}
            <Typography variant="caption" sx={{ color: ok ? "text.primary" : "text.secondary" }}>
              {rule.label}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
