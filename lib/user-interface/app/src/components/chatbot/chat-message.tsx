import * as React from "react";
import { useState, useMemo, useCallback, useRef } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../../styles/chat.module.scss";
import { brand } from "../../common/brand";
import { ChatBotHistoryItem, ChatBotMessageType, FeedbackSubmission } from "./types";
import type { StreamingStatus } from "../../hooks/useWebSocketChat";
import { groupSources, visibleSources, type SourceItem } from "./chat-sources";
import { buildMarkdownComponents } from "./markdown-components";
import MessageFeedback from "./message-feedback";
import SourcesPanel from "./sources-panel";

const COPIED_RESET_MS = 2000;
const HIGHLIGHT_MS = 1500;
/** Wait for the sources Collapse to open before scrolling a card into view. */
const SOURCES_OPEN_DELAY_MS = 250;

export interface ChatMessageProps {
  message: ChatBotHistoryItem;
  isLastAiMessage?: boolean;
  streamingStatus?: StreamingStatus;
  onThumbsUp: () => Promise<void> | void;
  onSubmitFeedback: (
    payload: Omit<FeedbackSubmission, "messageId" | "feedbackKind">
  ) => Promise<void> | void;
  onOpenSource?: (s3Key: string) => void;
}

function ChatMessage(props: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [highlightedChunk, setHighlightedChunk] = useState<number | null>(null);
  const sourcesListRef = useRef<HTMLDivElement>(null);
  // Only live answers carry a trace id to attach feedback to.
  const canSubmitFeedback = Boolean(props.message.metadata?.Trace?.messageId);

  const formattedTime = props.message.timestamp
    ? new Date(props.message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  const content = props.message.content ?? "";

  const sourcesArray = useMemo(
    () => visibleSources(props.message.metadata?.Sources as SourceItem[] | undefined),
    [props.message.metadata?.Sources]
  );
  const citedSources = useMemo(() => sourcesArray.filter((s) => s.cited === true), [sourcesArray]);
  const showSources = citedSources.length > 0;
  const sourceGroups = useMemo(() => groupSources(citedSources), [citedSources]);

  const scrollToChunk = useCallback((chunkIndex: number) => {
    const el = sourcesListRef.current?.querySelector(
      `[data-chunk-indices~="${chunkIndex}"]`
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlightedChunk(chunkIndex);
      setTimeout(() => setHighlightedChunk(null), HIGHLIGHT_MS);
    }
  }, []);

  const handleCitationClick = useCallback(
    (chunkIndex: number) => {
      if (!sourcesOpen) {
        setSourcesOpen(true);
        setTimeout(() => scrollToChunk(chunkIndex), SOURCES_OPEN_DELAY_MS);
      } else {
        scrollToChunk(chunkIndex);
      }
    },
    [sourcesOpen, scrollToChunk]
  );

  const mdComponents = useMemo(
    () => buildMarkdownComponents(sourcesArray, handleCitationClick),
    [sourcesArray, handleCitationClick]
  );

  const handleCopy = () => {
    void navigator.clipboard.writeText(props.message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  if (props.message?.type === ChatBotMessageType.Human) {
    return (
      <div>
        <article className={styles.humanMessage} aria-label="Message from you">
          <div className={styles.humanMessageInner}>
            <div className={styles.humanBubble}>{content}</div>
            {formattedTime && (
              <Typography
                variant="caption"
                component="span"
                sx={{ display: "block", textAlign: "right", mt: 0.5, color: "text.secondary", fontSize: "0.75rem" }}
              >
                {formattedTime}
              </Typography>
            )}
          </div>
        </article>
      </div>
    );
  }

  if (props.message?.type !== ChatBotMessageType.AI) return <div />;

  return (
    <div>
      <article
        className={styles.aiMessage}
        aria-label={`Message from ${brand.shortName}`}
        aria-busy={Boolean(
          props.isLastAiMessage && (props.streamingStatus?.active || content.length === 0)
        )}
      >
        <Avatar
          className={styles.aiAvatar}
          aria-hidden="true"
          src={brand.assets.icon}
          alt=""
          sx={{ width: 32, height: 32, bgcolor: "transparent" }}
        />
        <Box className={`${styles.aiContent} ${styles.messageWrapper}`} sx={{ minWidth: 0, flex: 1 }}>
          <Paper
            variant="outlined"
            sx={{ p: 2, bgcolor: "var(--app-chatAiBg)", borderColor: "var(--app-chatAiBorder)" }}
          >
            {content.length === 0 && !props.streamingStatus?.active ? (
              <div
                className={styles.statusIndicator}
                role="status"
                aria-live="polite"
                aria-label={`${brand.shortName} is thinking`}
              >
                <CircularProgress size={14} sx={{ color: "primary.main" }} aria-hidden="true" />
                <Typography variant="body2" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                  Thinking…
                </Typography>
              </div>
            ) : null}

            {props.isLastAiMessage && props.streamingStatus?.active ? (
              <div
                className={styles.statusIndicator}
                role="status"
                aria-live="off"
                aria-label={`${brand.shortName}: ${props.streamingStatus.text || "responding"}`}
              >
                <CircularProgress size={14} sx={{ color: "primary.main" }} aria-hidden="true" />
                <Typography variant="body2" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                  {props.streamingStatus.text}
                </Typography>
              </div>
            ) : null}

            {content.length > 0 && (
              <div className={styles.btn_chabot_message_copy}>
                <Tooltip title={copied ? "Copied!" : "Copy to clipboard"} placement="top">
                  <IconButton size="small" onClick={handleCopy} aria-label="Copy message to clipboard">
                    {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </div>
            )}

            <Box
              sx={{
                "& p": { my: 0.5 },
                "& p:first-of-type": { mt: 0 },
                "& p:last-of-type": { mb: 0 },
                lineHeight: 1.7,
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {content}
              </ReactMarkdown>
              {props.isLastAiMessage && content.length > 0 && !props.streamingStatus?.active && !showSources ? (
                <span className={styles.streamingCursor} aria-hidden="true" />
              ) : null}
            </Box>

            {content.length > 0 && canSubmitFeedback && (
              <MessageFeedback onThumbsUp={props.onThumbsUp} onSubmitFeedback={props.onSubmitFeedback} />
            )}
          </Paper>

          {showSources && (
            <SourcesPanel
              ref={sourcesListRef}
              groups={sourceGroups}
              open={sourcesOpen}
              onToggle={() => setSourcesOpen((o) => !o)}
              highlightedChunk={highlightedChunk}
              onOpenSource={props.onOpenSource}
            />
          )}
        </Box>
      </article>
    </div>
  );
}

// Re-render only when the message object itself changes (streaming appends a new
// object for the last message), or when the streaming status/flag changes.
// Callback props are intentionally excluded from comparison: they reference
// stable functions and don't affect render output for completed messages.
export default React.memo(ChatMessage, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isLastAiMessage === next.isLastAiMessage &&
    prev.streamingStatus === next.streamingStatus
  );
});
