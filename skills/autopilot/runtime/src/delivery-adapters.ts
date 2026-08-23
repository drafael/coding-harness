import { GitHubDeliveryAdapter } from "../delivery/github/index.js";
import { GitLabDeliveryAdapter } from "../delivery/gitlab/index.js";
import type { DeliveryPort } from "./delivery.js";
import { AutopilotError } from "./errors.js";

export function createDeliveryAdapter(provider: string): DeliveryPort {
  if (provider === "github") {
    return new GitHubDeliveryAdapter();
  }
  if (provider === "gitlab") {
    return new GitLabDeliveryAdapter();
  }
  throw new AutopilotError("ADAPTER_UNSUPPORTED", `unknown delivery provider: ${provider}`);
}
