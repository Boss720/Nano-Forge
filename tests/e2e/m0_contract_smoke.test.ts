import { afterEach, describe, expect, it } from "vitest";
import { CLOSE_INVALID_MESSAGE, CLOSE_UNAUTHORIZED } from "../../apps/agent-host/src/server.js";
import { launchE2ETestHost, type E2ETestHost, type WsLike } from "./helpers/testHost.js";

function nextMessage(ws: WsLike): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "message",
      (event) => resolve(JSON.parse(String(event.data))),
      { once: true },
    );
  });
}

describe("M0 contract smoke", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  it("authenticates once, rejects token reuse, and closes malformed frames with 4400", async () => {
    e2eHost = await launchE2ETestHost();

    const rejected = e2eHost.connectRaw("invalid_token");
    expect((await rejected.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);

    const acceptedToken = e2eHost.host.tokenStore.issue();
    const accepted = e2eHost.connectRaw(acceptedToken);
    await accepted.waitForOpen();
    const ready = await nextMessage(accepted.ws);
    expect(ready.type).toBe("host.ready");
    accepted.ws.close();
    await accepted.waitForClose();

    const reused = e2eHost.connectRaw(acceptedToken);
    expect((await reused.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);

    const malformedToken = e2eHost.host.tokenStore.issue();
    const malformed = e2eHost.connectRaw(malformedToken);
    await malformed.waitForOpen();
    await nextMessage(malformed.ws);
    malformed.ws.send("{ this is not json");
    expect((await malformed.waitForClose()).code).toBe(CLOSE_INVALID_MESSAGE);

    const schemaToken = e2eHost.host.tokenStore.issue();
    const schemaInvalid = e2eHost.connectRaw(schemaToken);
    await schemaInvalid.waitForOpen();
    await nextMessage(schemaInvalid.ws);
    schemaInvalid.ws.send(JSON.stringify({ type: "plan.submit", plan: "not-an-object" }));
    expect((await schemaInvalid.waitForClose()).code).toBe(CLOSE_INVALID_MESSAGE);
  });
});
