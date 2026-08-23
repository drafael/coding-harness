export class AutopilotError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "AutopilotError";
        this.code = code;
        this.details = details;
    }
}
