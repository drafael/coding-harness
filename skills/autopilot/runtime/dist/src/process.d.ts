import { type ChildProcessWithoutNullStreams } from "node:child_process";
export interface ProcessRequest {
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly stdin?: string | Uint8Array;
    readonly timeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly signal?: AbortSignal;
    readonly onStderrLine?: (line: string) => void;
    readonly onActivity?: () => void;
    readonly onSpawn?: (pid: number) => void;
    readonly detached?: boolean;
    readonly terminationProcessGroupId?: number;
    readonly terminate?: (pid: number) => Promise<void>;
    readonly redactValues?: readonly string[];
}
export interface ProcessResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
}
export declare function terminateDirectChild(child: ChildProcessWithoutNullStreams, label: string): Promise<void>;
export declare function terminateProcessTree(pid: number, executable: string): Promise<void>;
export declare class StreamingRedactor {
    #private;
    constructor(values: readonly string[]);
    write(chunk: Buffer): string;
    end(): string;
}
export declare function boundUtf8(text: string, maximumBytes: number): {
    readonly value: string;
    readonly truncated: boolean;
};
export declare function runProcess(request: ProcessRequest): Promise<ProcessResult>;
export declare function runChecked(request: ProcessRequest): Promise<ProcessResult>;
