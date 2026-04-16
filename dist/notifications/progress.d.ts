/**
 * Progress notifier that wraps the MCP server notification API.
 * All methods are no-ops when disabled (BRIDGE_DISABLE_PROGRESS=true).
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */
/** Minimal interface for sending MCP notifications. */
export type NotificationSender = (notification: {
    method: string;
    params: Record<string, unknown>;
}) => void;
/**
 * Sends MCP progress notifications during long-running operations.
 * Constructed with a `sendNotification` callback and an optional `disabled` flag.
 * When `disabled` is true, all methods are no-ops (Requirement 15.7).
 */
export declare class ProgressNotifier {
    private sendNotification;
    private disabled;
    constructor(sendNotification: NotificationSender, disabled?: boolean);
    /**
     * Notifies that processing has started.
     * Requirement 15.2
     */
    started(estimatedChunks: number): void;
    /**
     * Notifies that a single chunk has been processed.
     * Requirement 15.3
     */
    chunkDone(index: number, total: number, elapsedMs: number): void;
    /**
     * Notifies that the Reduce phase has begun.
     * Requirement 15.4
     */
    reducing(summaryCount: number): void;
    /**
     * Notifies that a file has been read.
     * Requirement 15.5
     */
    fileRead(filePath: string, tokenEstimate: number): void;
    /**
     * Notifies that the bridge is still waiting for Ollama to respond.
     * Requirement 15.6
     */
    waiting(elapsedMs: number): void;
    /**
     * Notifies that a request has been queued.
     * Requirement 15.1
     */
    queued(position: number, total: number): void;
}
//# sourceMappingURL=progress.d.ts.map