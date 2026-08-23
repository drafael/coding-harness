export interface ProcessRequest {
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly stdin?: string;
    readonly timeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly signal?: AbortSignal;
    readonly onStderrLine?: (line: string) => void;
}
export interface ProcessResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
}
export declare function runProcess(request: ProcessRequest): Promise<ProcessResult>;
export declare function runChecked(request: ProcessRequest): Promise<ProcessResult>;
