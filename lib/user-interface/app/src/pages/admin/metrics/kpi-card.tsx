import React from "react";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";

// ---------- KPI card with optional delta ----------

interface KPICardProps {
  title: string;
  value: string | number;
  previous?: number;
  icon: React.ReactNode;
  invertDelta?: boolean;
}

type Delta = { pct: number; up: boolean | null };

function computeDelta(value: string | number, previous?: number): Delta | null {
  if (typeof value !== "number" || typeof previous !== "number") return null;
  if (previous === 0 && value === 0) return { pct: 0, up: null };
  if (previous === 0) return { pct: 100, up: true };
  const pct = ((value - previous) / previous) * 100;
  return { pct, up: pct === 0 ? null : pct > 0 };
}

export default function KPICard({ title, value, previous, icon, invertDelta }: KPICardProps) {
  const delta = computeDelta(value, previous);

  const positive = delta?.up === true;
  const negative = delta?.up === false;
  const good = invertDelta ? negative : positive;
  const bad = invertDelta ? positive : negative;

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              {title}
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5 }}>
              {typeof value === "number" ? value.toLocaleString() : value}
            </Typography>
            {delta && (
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
                {delta.up === null ? (
                  <TrendingFlatIcon fontSize="small" color="action" />
                ) : good ? (
                  <TrendingUpIcon fontSize="small" color="success" />
                ) : bad ? (
                  <TrendingDownIcon fontSize="small" color="error" />
                ) : (
                  <TrendingFlatIcon fontSize="small" color="action" />
                )}
                <Typography
                  variant="caption"
                  color={good ? "success.main" : bad ? "error.main" : "text.secondary"}
                >
                  {delta.up === null ? "no change" : `${Math.abs(delta.pct).toFixed(1)}%`}
                  <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 0.5 }}>
                    vs. prior period
                  </Typography>
                </Typography>
              </Stack>
            )}
          </Box>
          <Box
            sx={{
              bgcolor: "primary.light",
              borderRadius: 2,
              p: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "primary.main",
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
