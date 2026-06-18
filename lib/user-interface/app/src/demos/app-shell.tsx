/**
 * AppShell — the shared PALETTE chrome (dark top header + left nav rail) that wraps
 * every demo so the mockups read as the real product. The `active` nav id
 * changes per demo. Uses the app's real icon library (@mui/icons-material).
 */
import { type ReactNode } from "react";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import HistoryIcon from "@mui/icons-material/History";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import AddIcon from "@mui/icons-material/Add";
import { PALETTE } from "./demo-kit";

export type NavId = "chat" | "sessions" | "data" | "quality" | "feedback" | "metrics";

const NAV: { group: string; items: { id: NavId; label: string; Icon: typeof ChatBubbleOutlineIcon }[] }[] = [
  {
    group: "Chatbot",
    items: [
      { id: "chat", label: "Chat", Icon: ChatBubbleOutlineIcon },
      { id: "sessions", label: "Sessions", Icon: HistoryIcon },
    ],
  },
  {
    group: "Admin",
    items: [
      { id: "data", label: "Data", Icon: StorageOutlinedIcon },
      { id: "quality", label: "Quality Monitoring", Icon: FactCheckOutlinedIcon },
      { id: "feedback", label: "Feedback", Icon: ForumOutlinedIcon },
      { id: "metrics", label: "Analytics", Icon: InsightsOutlinedIcon },
    ],
  },
];

export const SHELL_HEADER_H = 52;
export const SHELL_SIDEBAR_W = 214;

export const SHELL_CSS = `
.app-app { display:flex; flex-direction:column; height:100%; }
.app-appheader {
  height:${SHELL_HEADER_H}px; flex-shrink:0; display:flex; align-items:center;
  gap:12px; padding:0 18px; background:${PALETTE.headerBg}; color:${PALETTE.headerText};
}
.app-appheader .menu { opacity:0.8; display:flex; }
.app-logo {
  width:30px; height:30px; border-radius:8px; background:${PALETTE.primary};
  color:#fff; display:flex; align-items:center; justify-content:center;
  font-weight:800; font-size:12px; letter-spacing:-0.02em;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12);
}
.app-wordmark { font-weight:700; font-size:14.5px; letter-spacing:-0.01em; }
.app-wordmark span { font-weight:400; opacity:0.62; margin-left:7px; font-size:13px; }
.app-avatar {
  margin-left:auto; width:30px; height:30px; border-radius:50%;
  background:rgba(255,255,255,0.14); color:#fff; display:flex;
  align-items:center; justify-content:center; font-weight:700; font-size:11px;
}
.app-appbody { flex:1; display:flex; min-height:0; }
.app-sidebar {
  width:${SHELL_SIDEBAR_W}px; flex-shrink:0; background:${PALETTE.sidebarBg};
  border-right:1px solid ${PALETTE.border}; padding:14px 12px; box-sizing:border-box;
  display:flex; flex-direction:column; gap:6px;
}
.app-newchat {
  display:flex; align-items:center; justify-content:center; gap:7px;
  padding:9px 12px; border-radius:8px; border:1px solid ${PALETTE.primary};
  color:${PALETTE.primary}; font-weight:600; font-size:13px; margin-bottom:8px;
}
.app-navgroup { font-size:10.5px; font-weight:700; letter-spacing:0.06em;
  text-transform:uppercase; color:${PALETTE.textTertiary}; padding:8px 10px 4px; }
.app-navitem {
  display:flex; align-items:center; gap:10px; padding:8px 10px;
  border-radius:8px; font-size:13.5px; color:${PALETTE.textSecondary}; font-weight:500;
}
.app-navitem.active { background:${PALETTE.primaryLight}; color:${PALETTE.primary}; font-weight:600; }
.app-navitem svg { font-size:18px; }
.app-appcontent { flex:1; min-width:0; overflow:hidden; background:${PALETTE.surface};
  padding:22px 26px; box-sizing:border-box; }
`;

export function AppShell({ active, children }: { active: NavId; children: ReactNode }) {
  return (
    <div className="app-app">
      <style>{SHELL_CSS}</style>
      <div className="app-appheader">
        <span className="menu"><MenuIcon style={{ fontSize: 20 }} /></span>
        <span className="app-logo">PALETTE</span>
        <span className="app-wordmark">
          Sonar<span></span>
        </span>
        <span className="app-avatar">EO</span>
      </div>
      <div className="app-appbody">
        <nav className="app-sidebar">
          <div className="app-newchat"><AddIcon style={{ fontSize: 18 }} /> New chat</div>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="app-navgroup">{g.group}</div>
              {g.items.map(({ id, label, Icon }) => (
                <div key={id} className={`app-navitem${id === active ? " active" : ""}`}>
                  <Icon /> {label}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <main className="app-appcontent">{children}</main>
      </div>
    </div>
  );
}
