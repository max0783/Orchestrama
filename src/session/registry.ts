/**
 * SessionRegistry stores per-session dynamic allowed directories.
 * 
 * In the stdio MCP server model, there is exactly one session per process
 * (the process is spawned per client and exits on disconnect), so in practice
 * the session ID is always "default". However, the interface is keyed by
 * session ID to keep the design testable and honest.
 */

export interface ISessionRegistry {
  /** Add directories to a session's dynamic list. Returns the new dynamic list. */
  addDirs(sessionId: string, dirs: string[]): string[];
  /** Get the dynamic dirs for a session (empty array if none declared). */
  getDynamicDirs(sessionId: string): string[];
  /** Remove all dynamic dirs for a session (called on disconnect). */
  clearSession(sessionId: string): void;
}

export class SessionRegistry implements ISessionRegistry {
  private readonly sessions = new Map<string, string[]>();

  addDirs(sessionId: string, dirs: string[]): string[] {
    const existing = this.sessions.get(sessionId) ?? [];
    // Union — no duplicates (normalised paths compared)
    const merged = Array.from(new Set([...existing, ...dirs]));
    this.sessions.set(sessionId, merged);
    return merged;
  }

  getDynamicDirs(sessionId: string): string[] {
    return this.sessions.get(sessionId) ?? [];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
