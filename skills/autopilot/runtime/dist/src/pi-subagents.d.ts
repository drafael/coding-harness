export interface PiSubagentsInstallation {
    readonly extensionPath: string;
    readonly version: string;
}
export declare function findPiSubagentsInstallation(cwd?: string): PiSubagentsInstallation | undefined;
