/**
 * §5 — Custom transport for the InstantSearch `chat` widget.
 *
 * Instead of pointing the widget at Algolia with a browser-side API key
 * (`<Chat agentId apiKey>`), we route completions through our own proxy
 * (`/api/chat`). The proxy holds the secured key and talks to Agent Studio, so
 * the browser never sees an Algolia credential.
 *
 * The endpoint speaks the Vercel AI SDK v5 protocol, which is exactly what our
 * proxy forwards from `/completions?...&compatibilityMode=ai-sdk-5`.
 */

// One stable id per page load, used to scope the secured key server-side.
const conversationId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `conv-${Date.now()}`;

export const chatTransport = {
  api: "/api/chat",
  headers: () => ({ "x-conversation-id": conversationId }),
};
