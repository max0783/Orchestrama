import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient, OllamaError } from "../../ollama/client.js";
// Helper to create a mock fetch response
function mockResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
        json: async () => JSON.parse(body),
    };
}
const BASE_URL = "http://localhost:11434";
const KEEP_ALIVE = "10m";
const VALID_GENERATE_RESPONSE = {
    model: "llama3",
    response: "Hello!",
    context: [1, 2, 3],
    done: true,
    total_duration: 1000000,
    eval_count: 5,
};
describe("OllamaClient", () => {
    let client;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fetchSpy;
    beforeEach(() => {
        client = new OllamaClient(BASE_URL, KEEP_ALIVE);
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    // --- generate() ---
    describe("generate()", () => {
        it("sends POST to /api/generate and returns parsed response", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(VALID_GENERATE_RESPONSE)));
            const result = await client.generate({ model: "llama3", prompt: "hi" });
            expect(result.response).toBe("Hello!");
            expect(fetchSpy).toHaveBeenCalledWith(`${BASE_URL}/api/generate`, expect.objectContaining({ method: "POST" }));
        });
        it("always includes keep_alive in the request body", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(VALID_GENERATE_RESPONSE)));
            await client.generate({ model: "llama3", prompt: "test" });
            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body);
            expect(body.keep_alive).toBe(KEEP_ALIVE);
        });
        it("overrides keep_alive from request with configured value", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(VALID_GENERATE_RESPONSE)));
            // Even if caller passes a different keep_alive, the client's config wins
            await client.generate({ model: "llama3", prompt: "test", keep_alive: "5m" });
            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body);
            expect(body.keep_alive).toBe(KEEP_ALIVE);
        });
        it("always sets stream: false", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(VALID_GENERATE_RESPONSE)));
            await client.generate({ model: "llama3", prompt: "test" });
            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body);
            expect(body.stream).toBe(false);
        });
        // --- Error classification ---
        it("throws OllamaError with service_unavailable on ECONNREFUSED", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "service_unavailable",
                message: expect.stringContaining(BASE_URL),
            });
        });
        it("throws OllamaError with service_unavailable on 'fetch failed'", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "service_unavailable",
            });
        });
        it("throws OllamaError with model_not_found on HTTP 404", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(404, "model not found"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "model_not_found",
                message: expect.stringContaining("llama3"),
            });
        });
        it("throws OllamaError with model_not_found when body contains 'model not found'", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(400, "error: model not found in registry"));
            await expect(client.generate({ model: "mistral", prompt: "hi" })).rejects.toMatchObject({
                code: "model_not_found",
                message: expect.stringContaining("mistral"),
            });
        });
        it("throws OllamaError with local_resource_exhausted on HTTP 500 + 'out of memory'", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(500, "out of memory"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "local_resource_exhausted",
            });
        });
        it("throws OllamaError with local_resource_exhausted on HTTP 500 + 'CUDA out of memory'", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(500, "CUDA out of memory: tried to allocate 2 GiB"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "local_resource_exhausted",
            });
        });
        it("throws OllamaError with local_resource_exhausted on HTTP 500 + 'not enough memory'", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(500, "not enough memory to load model"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                code: "local_resource_exhausted",
            });
        });
        it("throws OllamaError with response body as message for other HTTP errors", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(503, "service temporarily unavailable"));
            await expect(client.generate({ model: "llama3", prompt: "hi" })).rejects.toMatchObject({
                message: "service temporarily unavailable",
            });
        });
        it("OllamaError is an instance of Error", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
            try {
                await client.generate({ model: "llama3", prompt: "hi" });
            }
            catch (err) {
                expect(err).toBeInstanceOf(Error);
                expect(err).toBeInstanceOf(OllamaError);
            }
        });
    });
    // --- listModels() ---
    describe("listModels()", () => {
        it("returns array of model names from /api/tags", async () => {
            const tagsResponse = {
                models: [{ name: "llama3:latest" }, { name: "mistral:7b" }],
            };
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(tagsResponse)));
            const models = await client.listModels();
            expect(models).toEqual(["llama3:latest", "mistral:7b"]);
        });
        it("returns empty array when models list is empty", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify({ models: [] })));
            const models = await client.listModels();
            expect(models).toEqual([]);
        });
        it("throws service_unavailable on connection error", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));
            await expect(client.listModels()).rejects.toMatchObject({
                code: "service_unavailable",
            });
        });
    });
    // --- ping() ---
    describe("ping()", () => {
        it("returns loaded: true and responseTimeMs when response is fast", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify({ ...VALID_GENERATE_RESPONSE, load_duration: 0 })));
            const result = await client.ping("llama3");
            expect(result.loaded).toBe(true);
            expect(typeof result.responseTimeMs).toBe("number");
            expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
        });
        it("sends minimal generate request with empty prompt", async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse(200, JSON.stringify(VALID_GENERATE_RESPONSE)));
            await client.ping("llama3");
            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body);
            expect(body.prompt).toBe("");
            expect(body.model).toBe("llama3");
            expect(body.keep_alive).toBe(KEEP_ALIVE);
            expect(body.stream).toBe(false);
        });
        it("propagates OllamaError from generate()", async () => {
            fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
            await expect(client.ping("llama3")).rejects.toMatchObject({
                code: "service_unavailable",
            });
        });
    });
});
//# sourceMappingURL=ollama_client.test.js.map