import { brand } from "./brand";

export const feedbackTypes = [
  {label: "Accuracy", value:"accuracy", disabled: false},
  {label: "Relevance", value:"relevance", disabled: false},
  {label: "Clarity", value:"clarity", disabled: false},
  {label: "Formatting", value:"completeness", disabled: false},
  {label: "Incomplete", value:"incomplete", disabled: false},
  {label: "Other", value:"other", disabled: false}
]

export const CHATBOT_NAME = brand.assistantName;
export const WELCOME_PAGE = brand.welcomeMessage;

export const SUGGESTED_PROMPTS = [...brand.suggestedPrompts];
