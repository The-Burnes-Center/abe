import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PersonIcon from "@mui/icons-material/Person";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import type { UserBreakdown, UserBreakdownRow } from "../../../common/api-client/metrics-client";
import EmptyHint from "./empty-hint";
import { CSVRow, downloadCSV, rangeFilename } from "./csv";

// ---------- Users tab ----------

type UserSortKey = "display_name" | "messages";
type SortDir = "asc" | "desc";

const ROW_TOPIC_LIMIT = 3;

function UserRow({
  user,
  isOpen,
  onToggle,
}: {
  user: UserBreakdownRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <React.Fragment>
      <TableRow
        hover
        sx={{ cursor: "pointer" }}
        onClick={onToggle}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`user-details-${user.user_id}`}
      >
        <TableCell>
          <IconButton size="small" aria-label={isOpen ? "Collapse" : "Expand"}>
            {isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Stack direction="row" alignItems="center" spacing={1}>
            <PersonIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight="bold">{user.display_name}</Typography>
          </Stack>
        </TableCell>
        <TableCell align="right">
          <Typography fontWeight="bold">{user.messages}</Typography>
        </TableCell>
        <TableCell>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {user.top_topics.slice(0, ROW_TOPIC_LIMIT).map((t) => (
              <Chip key={t.topic} label={`${t.topic} (${t.count})`} size="small" variant="outlined" />
            ))}
          </Stack>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={4} sx={{ py: 0, borderBottom: isOpen ? undefined : "none" }}>
          <Collapse in={isOpen} timeout={200} unmountOnExit id={`user-details-${user.user_id}`}>
            <Box sx={{ py: 1.5, pl: 6 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Recent questions:
              </Typography>
              {user.recent_questions.map((q, i) => (
                <Box key={i} sx={{ py: 0.3 }}>
                  <Typography variant="body2" component="span">
                    &bull; {q.question}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="span" sx={{ ml: 1 }}>
                    ({q.topic})
                  </Typography>
                </Box>
              ))}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </React.Fragment>
  );
}

function UsersEmptyState() {
  return (
    <Box sx={{ mt: 3, textAlign: "center", py: 8 }}>
      <Typography variant="h4" component="h2" color="text.secondary">
        No user data yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 400, mx: "auto" }}>
        User-level analytics will appear here once users start chatting.
      </Typography>
    </Box>
  );
}

function UsersTable({
  users,
  sortKey,
  sortDir,
  onSort,
}: {
  users: UserBreakdownRow[];
  sortKey: UserSortKey;
  sortDir: SortDir;
  onSort: (key: UserSortKey) => void;
}) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  return (
    <TableContainer>
      <Table size="small" aria-label="Users">
        <TableHead>
          <TableRow>
            <TableCell width={50} />
            <TableCell sortDirection={sortKey === "display_name" ? sortDir : false}>
              <TableSortLabel active={sortKey === "display_name"} direction={sortKey === "display_name" ? sortDir : "asc"} onClick={() => onSort("display_name")}>
                User
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sortDirection={sortKey === "messages" ? sortDir : false}>
              <TableSortLabel active={sortKey === "messages"} direction={sortKey === "messages" ? sortDir : "asc"} onClick={() => onSort("messages")}>
                Messages
              </TableSortLabel>
            </TableCell>
            <TableCell>Top Topics</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((u) => {
            const isOpen = expandedUser === u.user_id;
            return (
              <UserRow
                key={u.user_id}
                user={u}
                isOpen={isOpen}
                onToggle={() => setExpandedUser(isOpen ? null : u.user_id)}
              />
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function UsersTab({
  userData,
  rangeLabel,
}: {
  userData: UserBreakdown | null;
  rangeLabel: string;
}) {
  const [search, setSearch] = useState("");
  const [minMessages, setMinMessages] = useState(0);
  const [sortKey, setSortKey] = useState<UserSortKey>("messages");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    if (!userData) return [];
    const q = search.trim().toLowerCase();
    const rows = userData.users.filter((u) => {
      if (u.messages < minMessages) return false;
      if (!q) return true;
      return u.display_name.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [userData, search, minMessages, sortKey, sortDir]);

  if (!userData || userData.users.length === 0) return <UsersEmptyState />;

  const toggleSort = (key: UserSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  const exportCSV = () => {
    const rows: CSVRow[] = [
      ["User", "Messages", "Top Topics"],
      ...filtered.map((u) => [
        u.display_name,
        u.messages,
        u.top_topics.map((t) => `${t.topic} (${t.count})`).join(" | "),
      ]),
    ];
    downloadCSV(rangeFilename("users", userData.range), rows);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>{userData.total_messages}</strong> messages from{" "}
        <strong>{userData.users.length}</strong> users in <strong>{rangeLabel}</strong>
      </Alert>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 280 }}
        />
        <TextField
          size="small"
          type="number"
          label="Min messages"
          value={minMessages}
          onChange={(e) => setMinMessages(Math.max(0, Number.parseInt(e.target.value || "0", 10)))}
          inputProps={{ min: 0 }}
          sx={{ width: 140 }}
        />
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportCSV} disabled={filtered.length === 0}>
          Export CSV
        </Button>
      </Stack>

      <Card>
        <CardContent>
          <Typography variant="h4" component="h2" gutterBottom>
            All Users
          </Typography>
          {filtered.length === 0 ? (
            <EmptyHint message="No users match the current search / threshold." />
          ) : (
            <UsersTable users={filtered} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
