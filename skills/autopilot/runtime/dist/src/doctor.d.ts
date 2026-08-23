export interface DoctorCheck {
    readonly name: string;
    readonly status: "ok" | "missing" | "unsupported" | "unverified";
    readonly detail: string;
    readonly setup?: string;
}
export declare function runDoctor(): Promise<readonly DoctorCheck[]>;
