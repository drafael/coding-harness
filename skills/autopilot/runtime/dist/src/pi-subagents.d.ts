export interface PiSubagentsInstallation {
    readonly extensionPath: string;
    readonly version: string;
}
export interface ProcessLocalEventBus {
    on(event: string, handler: (value: unknown) => void): () => void;
    emit(event: string, value: unknown): void;
}
export declare function findPiSubagentsInstallation(cwd?: string): PiSubagentsInstallation | undefined;
export declare function probePiSubagentsOwner(events: ProcessLocalEventBus, timeoutMs?: number): Promise<boolean>;
