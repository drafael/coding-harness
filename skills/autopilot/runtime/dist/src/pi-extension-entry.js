import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { registerAutopilotPiExtension } from "./pi-extension.js";
export default function register(pi) {
    registerAutopilotPiExtension(pi, { piVersion: PI_VERSION });
}
