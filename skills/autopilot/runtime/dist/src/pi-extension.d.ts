import { type PiEventBus } from "../adapters/pi/in-process.js";
interface PiCommandContext {
    readonly cwd: string;
    readonly sessionManager: {
        getSessionId(): string | undefined;
    };
    readonly ui: {
        notify(message: string, level: "info" | "warning" | "error"): void;
    };
}
interface PiExtensionApi {
    readonly events: PiEventBus;
    on(event: "session_shutdown", handler: (event: {
        readonly reason: string;
    }) => void): void;
    registerCommand(name: string, options: {
        readonly description: string;
        readonly handler: (arguments_: string, context: PiCommandContext) => Promise<void>;
    }): void;
}
export declare function registerAutopilotPiExtension(pi: PiExtensionApi, options?: {
    readonly piVersion?: string;
}): void;
export default registerAutopilotPiExtension;
