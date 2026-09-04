export declare const CLAUDE_AGENT_SDK_ROOT_ENVIRONMENT = "AUTOPILOT_CLAUDE_AGENT_SDK_ROOT";
export declare const CLAUDE_AGENT_SDK_CLI_ENVIRONMENT = "AUTOPILOT_CLAUDE_AGENT_SDK_CLI";
export declare const MINIMUM_CLAUDE_AGENT_SDK_VERSION = "0.3.246";
export interface ClaudeAgentSdkInstallation {
    readonly root: string;
    readonly modulePath: string;
    readonly cliPath: string;
    readonly sdkVersion: string;
    readonly claudeCodeVersion: string;
}
export declare function isClaudeAgentSdkScriptCli(cliPath: string): boolean;
export declare function isSupportedClaudeAgentSdkVersion(value: string): boolean;
export declare function inspectClaudeAgentSdkInstallation(rootValue?: string | undefined, cliValue?: string | undefined): Promise<ClaudeAgentSdkInstallation>;
