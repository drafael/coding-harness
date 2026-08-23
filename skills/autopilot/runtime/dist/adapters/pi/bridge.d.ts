interface PiExtensionApi {
    readonly events: {
        on(event: string, handler: (value: unknown) => void): () => void;
        emit(event: string, value: unknown): void;
    };
    registerCommand(name: string, options: {
        readonly description: string;
        readonly handler: (arguments_: string, context: {
            readonly cwd: string;
        }) => Promise<void>;
    }): void;
    sendMessage(message: {
        readonly customType: string;
        readonly content: string;
        readonly display: boolean;
        readonly details: Readonly<Record<string, unknown>>;
    }): void;
}
export default function registerAutopilotPiBridge(pi: PiExtensionApi): void;
export {};
