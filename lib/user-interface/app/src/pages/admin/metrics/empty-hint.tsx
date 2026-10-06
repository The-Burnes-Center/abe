import { Box, Typography } from "@mui/material";

export default function EmptyHint({ message }: { message: string }) {
  return (
    <Box sx={{ textAlign: "center", py: 6 }}>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
