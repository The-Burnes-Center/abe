/**
 * Runtime config served at /aws-exports.json. Written by CDK at deploy time
 * (lib/user-interface/index.ts) and by the Vite dev plugin locally.
 */
export interface AppConfig {
  Auth: {
    region: string;
    userPoolId: string;
    userPoolWebClientId: string;
    /** Accepted as an alias of userPoolWebClientId. */
    userPoolClientId?: string;
  };
  httpEndpoint: string;
  wsEndpoint: string;
  /** True when the deployment allows self sign-up (domain allowlist enforced server-side). */
  selfSignUpEnabled?: boolean;
  /** False when the stack was deployed with enableEval=false (defaults to true). */
  evalEnabled?: boolean;
}

export interface NavigationPanelState {
  collapsed?: boolean;
  collapsedSections?: Record<number, boolean>;
}

export type LoadingStatus = "pending" | "loading" | "finished" | "error";
export type AdminDataType =
  | "file"
  | "feedback"
  | "evaluationSummary"
  | "detailedEvaluation";
