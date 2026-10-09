import { describe, expect, it } from "vitest";
import { classifyAccess, isAccessBlocked } from "../src/lib/access";

describe("classifyAccess", () => {
  it("allows public content", () => {
    const state = classifyAccess({ scope: "board", httpStatus: 200, body: "<html>posts</html>" });
    expect(state.code).toBe("public");
    expect(isAccessBlocked(state)).toBe(false);
  });

  it("detects a login redirect", () => {
    const state = classifyAccess({ scope: "board", httpStatus: 200, finalUrl: "https://nid.naver.com/nidlogin.login" });
    expect(state.code).toBe("login_required");
    expect(state.message).toContain("로그인");
  });

  it("detects a login form even on a 200 response", () => {
    const state = classifyAccess({
      scope: "board",
      httpStatus: 200,
      body: '<form action="/login"><input type="password"></form> 로그인'
    });
    expect(state.code).toBe("login_required");
  });

  it("detects membership requirement", () => {
    expect(classifyAccess({ scope: "board", httpStatus: 200, body: "카페 가입 후 이용" }).code).toBe(
      "membership_required"
    );
  });

  it("detects pending approval", () => {
    expect(classifyAccess({ scope: "board", httpStatus: 200, body: "가입 승인 대기 중입니다" }).code).toBe(
      "approval_required"
    );
  });

  it("detects a required grade and includes it", () => {
    const state = classifyAccess({ scope: "board", httpStatus: 200, body: "등업 후 이용 가능", requiredGrade: "준회원" });
    expect(state.code).toBe("grade_required");
    expect(state.message).toContain("준회원");
  });

  it("maps 403 to denied when logged in and login_required otherwise", () => {
    expect(classifyAccess({ scope: "board", httpStatus: 403, loggedIn: true }).code).toBe("denied");
    expect(classifyAccess({ scope: "board", httpStatus: 403, loggedIn: false }).code).toBe("login_required");
  });

  it("maps other errors to denied without guessing", () => {
    expect(classifyAccess({ scope: "board", httpStatus: 500 }).code).toBe("denied");
  });

  it("returns unknown for no signal", () => {
    expect(classifyAccess({ scope: "board" }).code).toBe("unknown");
  });
});
