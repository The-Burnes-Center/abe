import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import { v4 as uuidv4 } from "uuid";
import { brand } from "../common/brand";

interface AdminPageLayoutProps {
  title: string;
  description?: string;
  breadcrumbLabel: string;
  children: ReactNode;
  actions?: ReactNode;
}

export default function AdminPageLayout({
  title,
  description,
  breadcrumbLabel,
  children,
  actions,
}: AdminPageLayoutProps) {
  const navigate = useNavigate();

  // Access is enforced once, by the AdminRoute guard on /admin/*.
  return (
    <Stack spacing={3}>
      <Breadcrumbs aria-label="breadcrumb">
        <Link
          component="button"
          underline="hover"
          color="inherit"
          onClick={() => navigate(`/chatbot/playground/${uuidv4()}`)}
          sx={{ fontSize: "0.8125rem" }}
        >
          {brand.shortName}
        </Link>
        <Typography color="text.primary" sx={{ fontSize: "0.8125rem" }}>
          {breadcrumbLabel}
        </Typography>
      </Breadcrumbs>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1}
      >
        <Box>
          <Typography variant="h2" component="h1">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}
        </Box>
        {actions && <Box>{actions}</Box>}
      </Stack>

      {children}
    </Stack>
  );
}
