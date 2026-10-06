/**
 * Helpful / Not helpful controls for one assistant answer, with the inline
 * "what went wrong" form. Only rendered for answers that carry a trace
 * message id (live responses); reloaded history has none, so there is
 * nothing to attach feedback to and the controls are hidden.
 */
import { useId, useState } from "react";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbDownOutlinedIcon from "@mui/icons-material/ThumbDownOutlined";
import styles from "../../styles/chat.module.scss";
import { brand } from "../../common/brand";
import { useNotifications } from "../notif-manager";
import type { FeedbackSubmission } from "./types";

const SUCCESS_HIDE_MS = 3000;

const ISSUE_OPTIONS = [
  { id: "incorrect", label: "Incorrect" },
  { id: "missing", label: "Missing info" },
  { id: "irrelevant", label: "Off target" },
  { id: "unclear", label: "Unclear" },
  { id: "bad_source", label: "Bad source" },
  { id: "formatting", label: "Formatting" },
  { id: "other", label: "Other" },
];

interface MessageFeedbackProps {
  onThumbsUp: () => Promise<void> | void;
  onSubmitFeedback: (
    payload: Omit<FeedbackSubmission, "messageId" | "feedbackKind">
  ) => Promise<void> | void;
}

const buttonSx = { borderRadius: 1.5, px: 1, gap: 0.5 };

export default function MessageFeedback({ onThumbsUp, onSubmitFeedback }: MessageFeedbackProps) {
  const { addNotification } = useNotifications();
  const formId = useId();
  const hintId = useId();
  const [selectedIcon, setSelectedIcon] = useState<1 | 0 | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [regenerateRequested, setRegenerateRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetFeedback = () => {
    setSelectedIssues([]);
    setFeedbackComment("");
    setRegenerateRequested(false);
    setSubmitting(false);
  };

  const flashSuccess = () => {
    setFeedbackSuccess(true);
    setTimeout(() => setFeedbackSuccess(false), SUCCESS_HIDE_MS);
  };

  const toggleIssue = (issue: string) =>
    setSelectedIssues((current) =>
      current.includes(issue) ? current.filter((entry) => entry !== issue) : [...current, issue]
    );

  const handleHelpfulClick = async () => {
    if (selectedIcon === 1) return;
    try {
      await onThumbsUp();
      setSelectedIcon(1);
      setFeedbackOpen(false);
      resetFeedback();
      flashSuccess();
    } catch (error) {
      addNotification("error", (error as Error)?.message || "Could not save feedback.");
    }
  };

  const handleNotHelpfulClick = () => {
    if (feedbackOpen) {
      setFeedbackOpen(false);
      resetFeedback();
    } else {
      setFeedbackOpen(true);
      setFeedbackSuccess(false);
    }
  };

  const handleNegativeSubmit = async () => {
    if (selectedIssues.length === 0) {
      addNotification("error", "Select at least one issue.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmitFeedback({
        issueTags: selectedIssues,
        userComment: feedbackComment.trim(),
        expectedAnswer: "",
        wrongSnippet: "",
        sourceAssessment: "",
        regenerateRequested,
      });
      setFeedbackOpen(false);
      setSelectedIcon(0);
      flashSuccess();
      setSelectedIssues([]);
      setFeedbackComment("");
    } catch (error) {
      addNotification("error", (error as Error)?.message || "Could not submit feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.thumbsContainer} role="group" aria-label="Rate this response">
        <IconButton
          size="small"
          onClick={handleHelpfulClick}
          aria-label="Mark response as helpful"
          aria-pressed={selectedIcon === 1}
          sx={buttonSx}
        >
          {selectedIcon === 1 ? (
            <ThumbUpIcon sx={{ fontSize: 16 }} color="primary" />
          ) : (
            <ThumbUpOutlinedIcon sx={{ fontSize: 16 }} />
          )}
          <Typography
            variant="caption"
            sx={{ fontSize: "0.75rem", color: selectedIcon === 1 ? "primary.main" : "text.secondary" }}
          >
            Helpful
          </Typography>
        </IconButton>
        <IconButton
          size="small"
          onClick={handleNotHelpfulClick}
          aria-label="Mark response as not helpful and provide feedback"
          aria-pressed={selectedIcon === 0}
          aria-expanded={feedbackOpen}
          aria-controls={feedbackOpen ? formId : undefined}
          sx={buttonSx}
        >
          {selectedIcon === 0 || feedbackOpen ? (
            <ThumbDownIcon sx={{ fontSize: 16 }} color={selectedIcon === 0 ? "primary" : "action"} />
          ) : (
            <ThumbDownOutlinedIcon sx={{ fontSize: 16 }} />
          )}
          <Typography
            variant="caption"
            sx={{ fontSize: "0.75rem", color: selectedIcon === 0 ? "primary.main" : "text.secondary" }}
          >
            Not helpful
          </Typography>
        </IconButton>
      </div>

      <Collapse in={feedbackSuccess} timeout={200}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{
            mt: 1,
            py: 1,
            px: 1.5,
            borderRadius: 1,
            border: "1px solid",
            borderColor: "success.main",
            bgcolor: (t) => alpha(t.palette.success.main, 0.08),
          }}
          role="status"
          aria-live="polite"
        >
          <CheckCircleOutlineIcon sx={{ fontSize: 18, color: "success.main" }} />
          <Typography variant="body2" sx={{ fontSize: "0.8125rem", color: "text.primary" }}>
            {regenerateRequested
              ? `Thanks! ${brand.shortName} is retrying your question.`
              : "Thanks for your feedback!"}
          </Typography>
        </Stack>
      </Collapse>

      <Collapse in={feedbackOpen} timeout={200}>
        <Box
          id={formId}
          sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}
          role="form"
          aria-label="Feedback form"
        >
          <Stack spacing={1.5}>
            <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 600, fontSize: "0.8125rem" }}>
              What went wrong?{" "}
              <Typography component="span" variant="caption" color="text.secondary">
                (select all that apply)
              </Typography>
            </Typography>

            <Stack direction="row" gap={0.75} flexWrap="wrap" role="group" aria-label="Issue categories">
              {ISSUE_OPTIONS.map((issue) => {
                const selected = selectedIssues.includes(issue.id);
                return (
                  <Chip
                    key={issue.id}
                    label={issue.label}
                    size="small"
                    color={selected ? "primary" : "default"}
                    variant={selected ? "filled" : "outlined"}
                    onClick={() => toggleIssue(issue.id)}
                    aria-pressed={selected}
                    sx={{ fontSize: "0.75rem", height: 28 }}
                  />
                );
              })}
            </Stack>

            <TextField
              label="Tell us more (optional)"
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              placeholder="What did you expect instead? What was wrong?"
              inputProps={{ "aria-describedby": hintId }}
              sx={{ "& .MuiInputBase-root": { fontSize: "0.875rem" } }}
            />
            <Typography id={hintId} variant="caption" color="text.secondary" sx={{ fontSize: "0.75rem" }}>
              Your feedback helps improve {brand.shortName} for everyone.
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={regenerateRequested}
                  onChange={(e) => setRegenerateRequested(e.target.checked)}
                />
              }
              label={
                <Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
                  Also retry my question
                </Typography>
              }
            />

            <Stack direction="row" justifyContent="flex-end" gap={1}>
              <Button
                size="small"
                onClick={() => {
                  setFeedbackOpen(false);
                  resetFeedback();
                }}
                sx={{ fontSize: "0.8125rem" }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={handleNegativeSubmit}
                disabled={selectedIssues.length === 0 || submitting}
                sx={{ fontSize: "0.8125rem" }}
              >
                {submitting ? "Sending..." : "Send feedback"}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Collapse>
    </>
  );
}
