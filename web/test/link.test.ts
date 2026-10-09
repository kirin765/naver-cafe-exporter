import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { challengeForVerifier } from "../src/extensionLink";
import { approveLink, boot, login, redeemLink, startLink, type TestServer } from "./helpers";

const EMAIL = "link-user@example.com";
const INSTALL = "install_abc";

describe("extension link flow", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await boot();
  });

  afterEach(async () => {
    await server.close();
  });

  async function newLink() {
    const cookie = await login(server.base, EMAIL);
    const verifier = "verifier-secret-value";
    const challenge = challengeForVerifier(verifier);
    const start = await startLink(server.base, cookie, { challenge, installId: INSTALL });
    return { cookie, verifier, challenge, start };
  }

  it("rejects redeeming a request that has not been approved", async () => {
    const { verifier, challenge, start } = await newLink();
    const res = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: INSTALL
    });
    expect(res.status).toBe(409);
  });

  it("rejects a wrong verifier", async () => {
    const { cookie, challenge, start } = await newLink();
    await approveLink(server.base, cookie, start.requestId);
    const res = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier: "not-the-verifier",
      installId: INSTALL
    });
    expect(res.status).toBe(403);
  });

  it("rejects a wrong challenge", async () => {
    const { cookie, verifier, start } = await newLink();
    await approveLink(server.base, cookie, start.requestId);
    const res = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge: "not-the-challenge",
      verifier,
      installId: INSTALL
    });
    expect(res.status).toBe(403);
  });

  it("rejects an installId mismatch", async () => {
    const { cookie, verifier, challenge, start } = await newLink();
    await approveLink(server.base, cookie, start.requestId);
    const res = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: "different-install"
    });
    expect(res.status).toBe(403);
  });

  it("rejects an expired request", async () => {
    const { cookie, verifier, challenge, start } = await newLink();
    await approveLink(server.base, cookie, start.requestId);
    server.nowRef.value += server.config.linkTtlMs + 1000;
    const res = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: INSTALL
    });
    expect(res.status).toBe(410);
  });

  it("issues an extension token once and rejects reuse", async () => {
    const { cookie, verifier, challenge, start } = await newLink();
    await approveLink(server.base, cookie, start.requestId);

    const first = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: INSTALL
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { token: string; accountEmail: string | null };
    expect(body.token).toBeTruthy();
    expect(body.accountEmail).toBe(EMAIL);

    const second = await redeemLink(server.base, {
      requestId: start.requestId,
      challenge,
      verifier,
      installId: INSTALL
    });
    expect(second.status).toBe(409);

    const entitlement = await fetch(`${server.base}/api/entitlement`, {
      headers: { authorization: `Bearer ${body.token}` }
    });
    expect(entitlement.status).toBe(200);
  });

  it("requires login to view the connect page", async () => {
    const verifier = "verifier-secret-value";
    const challenge = challengeForVerifier(verifier);
    const start = await startLink(server.base, await login(server.base, EMAIL), { challenge, installId: INSTALL });

    const res = await fetch(`${server.base}/extension-connect?request=${start.requestId}`, {
      redirect: "manual"
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });
});
