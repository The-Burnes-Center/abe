/**
 * chat-kit — PALETTE chat-surface primitives, shared by the Chat (semantic RAG) and
 * Excel (structured query) demos. CSS is ported verbatim from
 * styles/chat.module.scss; class names + token values match the real app.
 */
import { type ReactNode } from "react";
import SendIcon from "@mui/icons-material/Send";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import MicNoneIcon from "@mui/icons-material/MicNone";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownOutlinedIcon from "@mui/icons-material/ThumbDownOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Spinner } from "./demo-kit";

export const CHAT_CSS = `
.app-chatcol { display:flex; flex-direction:column; height:100%; max-width:980px;
  margin:0 auto; width:100%; }
/* Conversation is bottom-anchored (newest content pinned above the input, like a
   real chat); the empty state centers itself. Fixed height + overflow hidden. */
.app-chatscroll { flex:1; min-height:0; overflow:hidden; padding:6px 4px 8px;
  display:flex; flex-direction:column; }
.app-chatstack { display:flex; flex-direction:column; gap:16px; }

/* ── empty state ── */
.app-empty { margin:auto 0; display:flex; flex-direction:column; align-items:center;
  justify-content:center; padding:10px 0; text-align:center; }
.app-empty-avatar { width:56px; height:56px; border-radius:8px;
  background:var(--app-primaryLight); color:var(--app-primary);
  display:flex; align-items:center; justify-content:center;
  font-weight:800; font-size:20px; letter-spacing:-0.02em; margin-bottom:18px; }
.app-empty h2 { margin:0 0 8px; font-size:24px; font-weight:700; color:var(--app-textPrimary); }
.app-empty p { margin:0 auto 4px; font-size:14px; color:var(--app-textSecondary); max-width:420px; line-height:1.5; }
.app-prompts { display:grid; grid-template-columns:1fr 1fr; gap:12px;
  margin-top:24px; max-width:620px; }
.app-promptcard { padding:14px 18px; border-radius:12px; border:1px solid var(--app-border);
  background:var(--app-surface); font-size:13.5px; line-height:1.5;
  color:var(--app-textPrimary); text-align:left; transition:all 150ms cubic-bezier(0.4,0,0.2,1); }
.app-promptcard.hot { border-color:var(--app-primary); background:var(--app-primaryLight);
  transform:translateY(-2px); box-shadow:var(--app-shadow-sm); }

/* ── messages ── */
.app-humanMessage { display:flex; justify-content:flex-end; width:100%; animation:slideUp 300ms ease-out; }
.app-humanInner { display:flex; flex-direction:column; align-items:flex-end; max-width:85%; }
.app-humanBubble { display:inline-block; max-width:100%; padding:10px 16px;
  border-radius:12px 12px 4px 12px; background:var(--app-chatHumanBg);
  color:var(--app-chatHumanText); font-size:15px; line-height:1.6; text-align:left;
  white-space:pre-wrap; }
.app-stamp { display:block; text-align:right; margin-top:5px; color:var(--app-textSecondary); font-size:12px; }

.app-aiMessage { display:flex; gap:12px; align-items:flex-start; animation:slideUp 300ms ease-out; }
.app-aiAvatar { flex-shrink:0; width:32px; height:32px; border-radius:8px;
  display:flex; align-items:center; justify-content:center; font-weight:800;
  font-size:10px; letter-spacing:-0.02em; margin-top:4px;
  background:var(--app-primaryLight); color:var(--app-primary); }
.app-aiContent { flex:1; min-width:0; }
.app-aiPaper { padding:16px; background:var(--app-chatAiBg);
  border:1px solid var(--app-chatAiBorder); border-radius:12px; position:relative; }
.app-aiPaper p { margin:8px 0; line-height:1.7; font-size:14.5px; }
.app-aiPaper p:first-of-type { margin-top:0; }
.app-aiPaper p:last-of-type { margin-bottom:0; }
.app-aiPaper strong { font-weight:700; }
.app-aiPaper ul { margin:8px 0; padding-left:22px; line-height:1.7; font-size:14.5px; }
.app-aiPaper li { margin:4px 0; }
.app-copybtn { position:absolute; top:10px; right:10px; opacity:0.4; color:var(--app-textSecondary); }

.app-statusIndicator { display:flex; align-items:center; gap:8px; padding:4px 0; animation:fadeIn 300ms ease-out; }
.app-statusIndicator span.txt { color:var(--app-textSecondary); font-style:italic; font-size:14px; }

.app-streamCursor { display:inline-block; width:2px; height:1em; background:var(--app-primary);
  margin-left:2px; vertical-align:text-bottom; animation:blinkCursor 1s step-end infinite; }

/* ── inline citation badge ── */
.app-citation { display:inline-flex; align-items:center; justify-content:center;
  min-width:18px; height:18px; padding:0 4px; margin:0 1px; border-radius:9px;
  background:var(--app-primaryLight); color:var(--app-primary); font-size:11px;
  font-weight:700; line-height:1; vertical-align:super; transition:all 150ms; }
.app-citation.hot { background:var(--app-primary); color:#fff; transform:scale(1.12); }

/* ── feedback thumbs ── */
.app-thumbs { display:flex; align-items:center; margin-top:10px; gap:2px;
  padding-top:8px; border-top:1px solid var(--app-borderSubtle); }
.app-thumb { display:inline-flex; align-items:center; gap:5px; padding:5px 8px;
  border-radius:8px; color:var(--app-textSecondary); font-size:12px; }
.app-thumb svg { font-size:16px; }

/* ── markdown table (Excel results) ── */
.app-mdtable { width:100%; border-collapse:collapse; margin-top:12px;
  border:1px solid var(--app-tableBorder); border-radius:8px; overflow:hidden; font-size:13.5px; }
.app-mdtable th, .app-mdtable td { border:1px solid var(--app-tableBorder); padding:9px 13px; text-align:left; }
.app-mdtable th { background:var(--app-tableHeaderBg); font-weight:600; }
.app-mdtable tr:nth-child(even) td { background:var(--app-tableStripeBg); }

/* ── sources panel ── */
.app-srcToggle { display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
  border-radius:8px; border:1px solid var(--app-borderSubtle); background:transparent;
  color:var(--app-textSecondary); font-size:13px; margin-top:8px; }
.app-srcToggle .chev { transition:transform 200ms ease; }
.app-srcToggle .chev.open { transform:rotate(180deg); }
.app-srcList { display:flex; flex-direction:column; gap:6px; margin-top:8px;
  overflow:hidden; animation:fadeIn 220ms ease-out; }
.app-srcRow { display:flex; align-items:center; gap:10px; padding:10px 12px;
  background:var(--app-surface); border:1px solid var(--app-borderSubtle);
  border-radius:8px; text-align:left; }
.app-srcRow .ic { font-size:18px; color:var(--app-primary); flex-shrink:0; }
.app-srcRow .body { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.app-srcRow .title { font-weight:600; font-size:13px; color:var(--app-textPrimary); }
.app-srcRow .meta { font-size:12px; color:var(--app-textSecondary); }
.app-srcRow .open { font-size:16px; color:var(--app-textTertiary); flex-shrink:0; }

/* ── input bar ── */
.app-inputwrap { flex-shrink:0; padding:14px 4px 4px; }
.app-input { display:flex; align-items:center; gap:8px; padding:8px 8px 8px 16px;
  border-radius:24px; background:var(--app-surface); border:1px solid var(--app-border);
  box-shadow:var(--app-shadow-md); }
.app-input.focus { border-color:var(--app-primary); box-shadow:var(--app-shadow-lg); }
.app-input .txt { flex:1; font-size:15px; color:var(--app-textPrimary); line-height:1.6; }
.app-input .txt.ph { color:var(--app-textTertiary); }
.app-mic { color:var(--app-textSecondary); display:flex; padding:6px; }
.app-send { display:inline-flex; align-items:center; gap:6px; padding:8px 16px;
  border-radius:16px; background:var(--app-primary); color:#fff; font-weight:600;
  font-size:14px; border:none; }
.app-send.disabled { background:var(--app-border); color:var(--app-textTertiary); }
.app-stop { display:inline-flex; align-items:center; justify-content:center; padding:7px;
  border-radius:50%; border:1px solid var(--app-error); color:var(--app-error); }
`;

/* ── components ───────────────────────────────────────────────────────────── */

export function AiAvatar() {
  return <div className="app-aiAvatar">PALETTE</div>;
}

export function HumanBubble({ text, stamp }: { text: string; stamp?: string }) {
  return (
    <div className="app-humanMessage">
      <div className="app-humanInner">
        <div className="app-humanBubble">{text}</div>
        {stamp && <span className="app-stamp">{stamp}</span>}
      </div>
    </div>
  );
}

export function Citation({ n, hot }: { n: number; hot?: boolean }) {
  return <span className={`app-citation${hot ? " hot" : ""}`}>{n}</span>;
}

export type DemoSource = { title: string; meta: string; excel?: boolean };

export function SourcesPanel({
  count,
  open,
  sources,
}: {
  count: number;
  open: boolean;
  sources: DemoSource[];
}) {
  return (
    <div style={{ marginTop: 4 }}>
      <button className="app-srcToggle" type="button" data-cursor="sources">
        <DescriptionOutlinedIcon style={{ fontSize: 16 }} />
        <span>
          {count} document{count !== 1 ? "s" : ""} referenced
        </span>
        <ExpandMoreIcon className={`chev${open ? " open" : ""}`} style={{ fontSize: 18 }} />
      </button>
      {open && (
        <div className="app-srcList">
          {sources.map((s, i) => (
            <div className="app-srcRow" key={i}>
              {s.excel ? (
                <TableChartOutlinedIcon className="ic" />
              ) : (
                <DescriptionOutlinedIcon className="ic" />
              )}
              <div className="body">
                <span className="title">{s.title}</span>
                <span className="meta">{s.meta}</span>
              </div>
              <OpenInNewIcon className="open" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Assistant message bubble. Pass `status` for the thinking/searching state, or
 *  `children` for streamed/finished content. */
export function AiBubble({
  status,
  children,
  showCursor,
  feedback,
  sources,
  sourcesOpen,
}: {
  status?: string;
  children?: ReactNode;
  showCursor?: boolean;
  feedback?: boolean;
  sources?: { count: number; open: boolean; items: DemoSource[] };
  sourcesOpen?: boolean;
}) {
  return (
    <div className="app-aiMessage">
      <AiAvatar />
      <div className="app-aiContent">
        <div className="app-aiPaper">
          {children && (
            <span className="app-copybtn">
              <ContentCopyIcon style={{ fontSize: 16 }} />
            </span>
          )}
          {status ? (
            <div className="app-statusIndicator">
              <Spinner size={14} />
              <span className="txt">{status}</span>
            </div>
          ) : null}
          {children}
          {showCursor ? <span className="app-streamCursor" /> : null}
          {feedback && (
            <div className="app-thumbs">
              <span className="app-thumb">
                <ThumbUpOutlinedIcon /> Helpful
              </span>
              <span className="app-thumb">
                <ThumbDownOutlinedIcon /> Not helpful
              </span>
            </div>
          )}
        </div>
        {sources && (
          <SourcesPanel count={sources.count} open={!!sourcesOpen} sources={sources.items} />
        )}
      </div>
    </div>
  );
}

/** The pinned bottom input. `value` shows typed text; empty shows placeholder. */
export function InputBar({
  value,
  sending,
  caret,
  focused,
}: {
  value: string;
  sending?: boolean;
  caret?: boolean;
  focused?: boolean;
}) {
  const empty = value.length === 0;
  return (
    <div className="app-inputwrap">
      <div className={`app-input${focused ? " focus" : ""}`}>
        <span className={`txt${empty ? " ph" : ""}`}>
          {empty ? "Ask PALETTE a question..." : value}
          {caret && <span className="app-streamCursor" style={{ height: "1.1em" }} />}
        </span>
        <span className="app-mic">
          <MicNoneIcon style={{ fontSize: 20 }} />
        </span>
        {sending ? (
          <span className="app-stop">
            <StopCircleOutlinedIcon style={{ fontSize: 18 }} />
          </span>
        ) : (
          <button className={`app-send${empty ? " disabled" : ""}`} type="button" data-cursor="send">
            Send <SendIcon style={{ fontSize: 16 }} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Empty-state hero with the 4 real suggested-prompt cards. */
export function ChatEmptyState({ hotIndex }: { hotIndex?: number }) {
  const prompts = [
    "Where do I find a list of available records?",
    "What does the latest policy say about this topic?",
    "Summarize the key points of this document.",
    "Which records match my criteria?",
  ];
  return (
    <div className="app-empty">
      <div className="app-empty-avatar">PALETTE</div>
      <h2>What can I help you with?</h2>
      <p>Ask me about your documents and data.</p>
      <div className="app-prompts">
        {prompts.map((p, i) => (
          <div
            className={`app-promptcard${i === hotIndex ? " hot" : ""}`}
            data-cursor={`prompt-${i}`}
            key={i}
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}
