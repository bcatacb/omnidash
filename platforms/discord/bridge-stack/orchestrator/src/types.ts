import { z } from "zod";

export const CreateAccountBody = z.object({
  tenant_id: z.string().min(1).max(128),
  label: z.string().min(1).max(128).optional(),
});
export type CreateAccountBody = z.infer<typeof CreateAccountBody>;

export const LoginBody = z.object({
  // For now we accept either a user token or a bot token; the bridge command
  // is the same shape ("login-token user <tok>" / "login-token bot <tok>").
  token: z.string().min(10),
  kind: z.enum(["user", "bot"]).default("user"),
});
export type LoginBody = z.infer<typeof LoginBody>;

export type AccountStatus =
  | "provisioning"
  | "ready"
  | "logging_in"
  | "logged_in"
  | "disconnected"
  | "errored"
  | "torn_down";

export interface AccountRecord {
  account_id: string;
  tenant_id: string;
  label: string;
  container_id: string | null;
  container_name: string;
  config_path: string;
  postgres_schema: string;
  as_token: string;
  hs_token: string;
  status: AccountStatus;
  last_state: string | null; // last status_endpoint payload (JSON string)
  created_at: number;
  updated_at: number;
}
