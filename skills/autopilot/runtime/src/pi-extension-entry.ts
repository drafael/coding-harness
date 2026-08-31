import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { registerAutopilotPiExtension } from "./pi-extension.js";

export default function register(pi: Parameters<typeof registerAutopilotPiExtension>[0]): void {
  registerAutopilotPiExtension(pi, { piVersion: PI_VERSION });
}
