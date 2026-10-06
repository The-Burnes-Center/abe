import { Box, Chip, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from "@mui/material";
import { Utils } from "../../../common/utils";
import {
  FilterState,
  PRESETS,
  PresetKey,
  daysBetween,
  formatRangeLabel,
  presetToRange,
  todayISO,
} from "./filters";

// ---------- Filter bar ----------

interface FilterBarProps {
  state: FilterState;
  onChange: (next: FilterState) => void;
}

export default function FilterBar({ state, onChange }: FilterBarProps) {
  const todayMax = todayISO();

  const setPreset = (key: PresetKey) => {
    if (key === "custom") {
      onChange({ ...state, preset: "custom" });
      return;
    }
    const { from, to } = presetToRange(key, state.from, state.to);
    onChange({ ...state, preset: key, from, to });
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        position: "sticky",
        top: 0,
        zIndex: 2,
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
            Range
          </Typography>
          {PRESETS.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              size="small"
              color={state.preset === p.key ? "primary" : "default"}
              variant={state.preset === p.key ? "filled" : "outlined"}
              onClick={() => setPreset(p.key)}
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {formatRangeLabel(state.from, state.to)} · {daysBetween(state.from, state.to)} days · All
            times {Utils.timezoneLabel()}
          </Typography>
        </Stack>

        {state.preset === "custom" && (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              type="date"
              size="small"
              label="From"
              value={state.from}
              onChange={(e) => onChange({ ...state, from: e.target.value })}
              inputProps={{ max: state.to || todayMax }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="date"
              size="small"
              label="To"
              value={state.to}
              onChange={(e) => onChange({ ...state, to: e.target.value })}
              inputProps={{ min: state.from, max: todayMax }}
              InputLabelProps={{ shrink: true }}
            />
            {state.from > state.to && (
              <Typography variant="caption" color="error">
                "From" must be on or before "To"
              </Typography>
            )}
          </Stack>
        )}

        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={state.compare}
                onChange={(e) => onChange({ ...state, compare: e.target.checked })}
              />
            }
            label="Compare to prior period"
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
