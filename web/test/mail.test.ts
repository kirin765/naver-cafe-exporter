import { describe, expect, it } from "vitest";
import { MemoryMailer } from "../src/mail";
import { loginPage } from "../src/pages";
import { boot, getCookie, postJson } from "./helpers";

describe("magic-link email", () => {
  it("emails a one-time link instead of returning it", async () => {
    const mailer = new MemoryMailer();
    const server = await boot({ mailer, config: { devLogEmail: false } });
    try {
      const res = await postJson(server.base, "/api/auth/magic-link", { email: "buyer@onnurimun.com" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { devLink?: string };
      expect(body.devLink).toBeUndefined();

      const mail = mailer.lastTo("buyer@onnurimun.com");
      expect(mail).toBeDefined();
      const link = /\bhttps?:\/\/\S+/.exec(mail!.text)?.[0];
      expect(link).toContain("/auth/verify?token=");

      const verify = await fetch(link!, { redirect: "manual" });
      expect(verify.status).toBe(302);
      expect(getCookie(verify)).toMatch(/^sid=/);
    } finally {
      await server.close();
    }
  });

  it("rejects a reused magic link", async () => {
    const mailer = new MemoryMailer();
    const server = await boot({ mailer, config: { devLogEmail: false } });
    try {
      await postJson(server.base, "/api/auth/magic-link", { email: "buyer@onnurimun.com" });
      const link = /\bhttps?:\/\/\S+/.exec(mailer.lastTo("buyer@onnurimun.com")!.text)![0];
      await fetch(link, { redirect: "manual" });
      const second = await fetch(link, { redirect: "manual" });
      expect(second.headers.get("location")).toContain("/login?error=expired");
    } finally {
      await server.close();
    }
  });
});

describe("login page", () => {
  it("renders the magic-link form", () => {
    const html = loginPage({ next: "/account" });
    expect(html).toContain("/api/auth/magic-link");
    expect(html).not.toContain("clerk");
  });
});
