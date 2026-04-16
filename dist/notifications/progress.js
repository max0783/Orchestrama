/**
 * Progress notifier that wraps the MCP server notification API.
 * All methods are no-ops when disabled (BRIDGE_DISABLE_PROGRESS=true).
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */
/**
 * Sends MCP progress notifications during long-running operations.
 * Constructed with a `sendNotification` callback and an optional `disabled` flag.
 * When `disabled` is true, all methods are no-ops (Requirement 15.7).
 */
export class ProgressNotifier {
    sendNotification;
    disabled;
    constructor(sendNotification, disabled = false) {
        this.sendNotification = sendNotification;
        this.disabled = disabled;
    }
    /**
     * Notifies that processing has started.
     * Requirement 15.2
     */
    started(estimatedChunks) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "started", estimatedChunks },
        });
    }
    /**
     * Notifies that a single chunk has been processed.
     * Requirement 15.3
     */
    chunkDone(index, total, elapsedMs) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "chunk_done", index, total, elapsedMs },
        });
    }
    /**
     * Notifies that the Reduce phase has begun.
     * Requirement 15.4
     */
    reducing(summaryCount) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "reducing", summaryCount },
        });
    }
    /**
     * Notifies that a file has been read.
     * Requirement 15.5
     */
    fileRead(filePath, tokenEstimate) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "file_read", filePath, tokenEstimate },
        });
    }
    /**
     * Notifies that the bridge is still waiting for Ollama to respond.
     * Requirement 15.6
     */
    waiting(elapsedMs) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "waiting", elapsedMs },
        });
    }
    /**
     * Notifies that a request has been queued.
     * Requirement 15.1
     */
    queued(position, total) {
        if (this.disabled)
            return;
        this.sendNotification({
            method: "notifications/progress",
            params: { status: "queued", position, total },
        });
    }
}
//# sourceMappingURL=progress.js.map