import { useState } from "react";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import ExpandMore from "@mui/icons-material/ExpandMore";
import ExpandLess from "@mui/icons-material/ExpandLess";
import { Link as RouterLink } from "react-router-dom";
import { CHATBOT_NAME } from "../../common/constants";
import { useDocumentTitle } from "../../common/hooks/use-document-title";
import DemoVideo from "../../components/onboarding/demo-video";

const prompts = [
  { title: "Spell out acronyms", details: "Avoid abbreviations. For example, write 'Request for Proposal' instead of 'RFP'." },
  { title: "Be specific and concise", details: "Provide clear and precise questions to help ABE give accurate responses." },
  { title: "Use keywords", details: "Include important terms in your query, such as 'vendor' or 'contract'." },
  { title: "Ask one question at a time", details: "Breaking down complex questions ensures better answers." },
  { title: "Include relevant details", details: "Specify important context, like names, dates, or locations, to guide the chatbot's response." },
  { title: "Ask follow-up questions", details: "Build on previous responses by asking follow-ups to get further clarity or additional details." },
];

const sampleQuestions = [
  {
    topic: "Getting started",
    items: [
      "What kinds of questions can you help with?",
      "What documents and data do you have access to?",
      "How do I get the most accurate answers?",
    ],
  },
  {
    topic: "Finding information",
    items: [
      "Summarize the key points of [document name].",
      "What does our policy say about [topic]?",
      "Where can I find information about [subject]?",
      "Which records match [criteria]?",
    ],
  },
  {
    topic: "Going deeper",
    items: [
      "Show me the sources behind that answer.",
      "Can you explain that in simpler terms?",
      "What related documents should I look at next?",
    ],
  },
];

function TipsTab() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <Stack spacing={3} sx={{ mt: 3 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
          Learn how to phrase your questions effectively and explore examples to guide
          your interactions for quick and accurate answers.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" sx={{ mb: 1 }}>
          See ABE in action
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A quick walkthrough of asking a question and getting an answer with sources.
        </Typography>
        <DemoVideo />
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" sx={{ mb: 2 }}>
          Prompting Tips
        </Typography>
        <Divider />
        <List disablePadding>
          {prompts.map((prompt, index) => (
            <Box
              component="li"
              key={index}
              sx={{ listStyle: "none", display: "block" }}
            >
              <ListItemButton
                onClick={() => toggle(`prompt-${index}`)}
                aria-expanded={!!expanded[`prompt-${index}`]}
                aria-controls={`help-prompt-panel-${index}`}
                sx={{ px: 0.5, borderRadius: 1 }}
              >
                {expanded[`prompt-${index}`] ? (
                  <ExpandLess sx={{ mr: 1 }} aria-hidden="true" />
                ) : (
                  <ExpandMore sx={{ mr: 1 }} aria-hidden="true" />
                )}
                <ListItemText
                  primary={prompt.title}
                  primaryTypographyProps={{ fontWeight: 600, fontSize: "0.9375rem" }}
                />
              </ListItemButton>
              <Collapse
                in={!!expanded[`prompt-${index}`]}
                timeout={200}
                id={`help-prompt-panel-${index}`}
              >
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4.5, pb: 1.5 }}>
                  {prompt.details}
                </Typography>
              </Collapse>
              {index < prompts.length - 1 && <Divider />}
            </Box>
          ))}
        </List>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" sx={{ mb: 1 }}>
          Sample Questions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These are examples to get you started. Replace anything in [brackets] with
          your own details &mdash; like the product, contract, or company you&apos;re
          asking about.
        </Typography>
        <Divider />
        <List disablePadding>
          {sampleQuestions.map((section, index) => (
            <Box
              component="li"
              key={index}
              sx={{ listStyle: "none", display: "block" }}
            >
              <ListItemButton
                onClick={() => toggle(`question-${index}`)}
                aria-expanded={!!expanded[`question-${index}`]}
                aria-controls={`help-question-panel-${index}`}
                sx={{ px: 0.5, borderRadius: 1 }}
              >
                {expanded[`question-${index}`] ? (
                  <ExpandLess sx={{ mr: 1 }} aria-hidden="true" />
                ) : (
                  <ExpandMore sx={{ mr: 1 }} aria-hidden="true" />
                )}
                <ListItemText
                  primary={section.topic}
                  primaryTypographyProps={{ fontWeight: 600, fontSize: "0.9375rem" }}
                />
              </ListItemButton>
              <Collapse
                in={!!expanded[`question-${index}`]}
                timeout={200}
                id={`help-question-panel-${index}`}
              >
                <Stack component="ul" spacing={0.5} sx={{ pl: 4.5, pb: 1.5, m: 0, listStyle: "disc" }}>
                  {section.items.map((q, qIndex) => (
                    <li key={qIndex}>
                      <Typography variant="body2" color="text.secondary">{q}</Typography>
                    </li>
                  ))}
                </Stack>
              </Collapse>
              {index < sampleQuestions.length - 1 && <Divider />}
            </Box>
          ))}
        </List>
      </Paper>
    </Stack>
  );
}

function AboutTab() {
  return (
    <Stack spacing={3} sx={{ mt: 3 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          ABE
        </Typography>
        <Typography variant="body1" color="text.secondary">
          ABE is an AI-powered assistant that answers questions from your
          organization's knowledge base. It uses advanced language models and
          retrieval over your curated documents to help users find answers
          quickly and accurately, with links to the sources.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          How It Works
        </Typography>
        <Typography variant="body1" color="text.secondary">
          ABE uses Retrieval-Augmented Generation (RAG) to search through your
          organization's documents and data and provide contextually relevant answers.
          Source documents are linked with each response so you can verify the information.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          Important Notes
        </Typography>
        <Typography variant="body1" color="text.secondary">
          ABE provides guidance based on available documentation. Always verify
          critical decisions against the official source documents, and consult the
          appropriate team for complex situations.
        </Typography>
      </Paper>
    </Stack>
  );
}

function SupportTab() {
  return (
    <Stack spacing={3} sx={{ mt: 3 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          Need Help?
        </Typography>
        <Typography variant="body1" color="text.secondary">
          If you encounter any issues or have questions about using ABE,
          please reach out to your system administrator or the ABE support team.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" component="h2" gutterBottom>
          Reporting Issues
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Use the thumbs-down feedback button on any response to report
          inaccurate or unhelpful answers. Your feedback helps improve ABE&apos;s
          accuracy over time.
        </Typography>
      </Paper>
    </Stack>
  );
}

export default function HelpPage() {
  useDocumentTitle("Help");
  const [tabIndex, setTabIndex] = useState(0);

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }} aria-label="breadcrumb">
        <MuiLink component={RouterLink} to="/" underline="hover" color="inherit" sx={{ fontSize: "0.8125rem" }}>
          {CHATBOT_NAME}
        </MuiLink>
        <Typography color="text.primary" sx={{ fontSize: "0.8125rem" }}>
          Help & Guide
        </Typography>
      </Breadcrumbs>

      <Typography variant="h2" component="h1" gutterBottom>
        Help & Guide
      </Typography>

      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        aria-label="Help sections"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Tips & Questions" id="help-tab-0" aria-controls="help-tabpanel-0" />
        <Tab label="About ABE" id="help-tab-1" aria-controls="help-tabpanel-1" />
        <Tab label="Support" id="help-tab-2" aria-controls="help-tabpanel-2" />
      </Tabs>

      {tabIndex === 0 && (
        <Box role="tabpanel" id="help-tabpanel-0" aria-labelledby="help-tab-0">
          <TipsTab />
        </Box>
      )}
      {tabIndex === 1 && (
        <Box role="tabpanel" id="help-tabpanel-1" aria-labelledby="help-tab-1">
          <AboutTab />
        </Box>
      )}
      {tabIndex === 2 && (
        <Box role="tabpanel" id="help-tabpanel-2" aria-labelledby="help-tab-2">
          <SupportTab />
        </Box>
      )}
    </Box>
  );
}
